/**
 * Whether a URL carries a credential: user info, a parameter named like one
 * (`token`, `access_token`, `api_key`, `password`, `sig`…), or a value shaped
 * like a known secret (GitHub, OpenAI and Slack tokens, AWS and Google keys,
 * JWTs, private keys, `Bearer …`) anywhere in it, also percent-encoded several
 * times or inside a URL nested in a parameter. Such a URL is refused in every
 * record, so neither the App nor a data pull request can commit a credential
 * into the data repository, which is often read by more people than the
 * credential should be.
 *
 * The rules are those of the Mission Control 3.x data validator
 * (`hasCredentialMaterialInUrl`), kept so that data 3.x accepted stays
 * accepted and data it refused stays refused.
 */

const MAX_DECODE_PASSES = 12;
const MAX_NESTING = 3;

/** A value shaped like a secret, whatever it is called. */
export function looksLikeCredential(candidate: string): boolean {
  const value = candidate.trim();
  return (
    /^(?:basic|bearer)\s+\S+/i.test(value) ||
    /(?:^|[^a-z0-9])(?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:basic|bearer)\s+\S+/i.test(
      value,
    ) ||
    /(?:^|[^a-z0-9])(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|ya29\.)[a-z0-9_-]{6,}/i.test(value) ||
    /(?:^|[^A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?:$|[^A-Z0-9])/.test(value) ||
    /(?:^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{20,}(?:$|[^A-Za-z0-9_-])/.test(value) ||
    /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:$|[^A-Za-z0-9_-])/.test(
      value,
    ) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
  );
}

/** A parameter or field name that names a credential. */
function isCredentialName(key: string): boolean {
  const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    ["auth", "jwt", "session", "sessionid", "sid", "sig"].includes(name) ||
    /(?:accessid|accesskey|apikey|authorization|credential|password|passwd|privatekey|secret|signature|token)/.test(
      name,
    )
  );
}

/**
 * A text and its percent-decoded forms. A text that does not decode cleanly
 * within the passes is `truncated`, and treated as a credential: what it hides
 * cannot be seen.
 */
function decodedForms(text: string): { forms: string[]; truncated: boolean } {
  const forms: string[] = [];
  let current = text;
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass += 1) {
    if (!forms.includes(current)) forms.push(current);
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return { forms, truncated: true };
    }
    if (decoded === current) return { forms, truncated: false };
    current = decoded;
  }
  return { forms, truncated: true };
}

/** `name=` in a query-like text, or `"name":` in a serialized object. */
function namesCredential(text: string): boolean {
  const parameter = /(?:^|[?&#;])([^=?&#;]+)=/g;
  const field = /(?:^|[?&#;,{[])\s*(?:\\?["'])?([^"'\\:=?&#;,[\]{}]+?)(?:\\?["'])?\s*:/g;
  return [parameter, field].some((pattern) =>
    [...text.matchAll(pattern)].some((match) => isCredentialName(match[1] ?? "")),
  );
}

function nestedUrl(text: string): URL | null {
  if (!/^(?:https?:\/\/|[/?#])/i.test(text)) return null;
  try {
    const url = new URL(text, "https://credential-scan.invalid/");
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function textHasCredential(text: string, depth: number): boolean {
  if (
    looksLikeCredential(text) ||
    namesCredential(text) ||
    (text.includes("=") && parametersHaveCredential(new URLSearchParams(text), depth))
  ) {
    return true;
  }
  const nested = nestedUrl(text);
  return Boolean(nested && (depth >= MAX_NESTING || urlHasCredential(nested, depth + 1)));
}

function parametersHaveCredential(parameters: URLSearchParams, depth: number): boolean {
  for (const [key, value] of parameters.entries()) {
    const names = decodedForms(key);
    if (names.truncated || names.forms.some(isCredentialName)) return true;
    const values = decodedForms(value);
    if (values.truncated) return true;
    if (values.forms.some((form) => textHasCredential(form, depth))) return true;
  }
  return false;
}

function urlHasCredential(url: URL, depth: number): boolean {
  if (url.username || url.password) return true;
  const host = decodedForms(url.hostname);
  if (host.truncated || host.forms.some(looksLikeCredential)) return true;
  if (parametersHaveCredential(url.searchParams, depth)) return true;
  const parts = [
    ...url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodedForms(segment)),
    decodedForms(url.hash.slice(1)),
  ];
  return parts.some(
    (part) => part.truncated || part.forms.some((form) => textHasCredential(form, depth)),
  );
}

/**
 * True when `value` carries a credential. A text that is not a URL is judged
 * by its decoded forms alone.
 */
export function hasCredential(value: string): boolean {
  const raw = decodedForms(value);
  if (raw.truncated || raw.forms.some(looksLikeCredential)) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return raw.forms.some((form) => namesCredential(form));
  }
  return urlHasCredential(url, 0);
}
