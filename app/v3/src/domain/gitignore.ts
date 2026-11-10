/**
 * Git's ignore rules, read and matched without Git: which paths `git add
 * --all` leaves out of a commit. `src/data/files.ts` walks a path with them;
 * this module reads one rule file and decides one path.
 *
 * Origin: written for Mission Control from Git's documented behaviour
 * (gitignore(5)) and from Git's own answers, asked as a black box: Git was
 * run on probe trees and its answers compared. No Git source code was read
 * or copied. `tests/gitignore.test.ts` compares it with Git on fixed and
 * generated rules and trees, on Linux and Windows; where the documentation
 * is silent, the comments below say what Git was seen to do.
 *
 * Paths are relative to the checkout's root, use `/`, and are compared as
 * UTF-8 bytes and case-sensitively, as Git does on Linux.
 *
 * A rule file, line by line:
 * - a UTF-8 byte order mark at its start is skipped; lines end at LF, and
 *   one CR at a line's end is dropped;
 * - a line starting with `#` is a comment; spaces at a line's end are
 *   dropped unless escaped with `\` (tabs stay); an empty line is nothing;
 * - `!` first negates the rule; `\!` and `\#` start a pattern literally;
 * - a `/` at the end makes the rule match directories only;
 * - a rule with a `/` anywhere else is anchored to the directory of its rule
 *   file (a leading `/` only anchors) and matched against the path below
 *   it; any other rule is matched against the last name of a path, at any
 *   depth below its rule file.
 *
 * A pattern, byte by byte:
 * - `?` is one byte and `*` any run of bytes, neither of them a `/`;
 * - two or more `*` that fill a whole part between slashes match across
 *   them: `**` followed by `/` is zero or more directories, `**` at the
 *   end, or before an escaped slash `\/`, any run of bytes, slashes
 *   included; elsewhere they are one `*`;
 * - `\` makes the next byte literal; a `\` at the end matches nothing;
 * - `[...]` is one byte of a set (`!` or `^` first negates it, `]` first is
 *   a member): bytes, escapes, ranges `a-z` (a reversed range such as `z-a`
 *   keeps only its first byte; a `-` first, last or right after a range is
 *   a member) and the ASCII classes `[:alpha:]` and the like; it never
 *   matches `/`. An unclosed set or an unknown class matches nothing.
 */

/** One line of a rule file. */
export interface IgnoreRule {
  /** The line as written, without its line end and trailing spaces: what messages show. */
  readonly pattern: string;
  /** The rule file, as messages name it (`.gitignore`, `sub/.gitignore`, `.git/info/exclude`). */
  readonly source: string;
  /** The rule's line in its file, from 1. */
  readonly line: number;
  /** `!`: a path it matches is not ignored. */
  readonly negated: boolean;
  /** A `/` at the end: the rule matches directories only. */
  readonly directoryOnly: boolean;
  /** No `/` before the end: the rule matches a path's last name, at any depth. */
  readonly nameOnly: boolean;
  /** The compiled pattern; null when it can match nothing. */
  readonly tokens: readonly Token[] | null;
}

/** The rules of one rule file and the directory they apply below ("" for the root). */
export interface IgnoreLevel {
  readonly base: string;
  readonly rules: readonly IgnoreRule[];
}

/** The rule that decides a path, and whether it leaves the path out. */
export interface IgnoreDecision {
  readonly ignored: boolean;
  readonly rule: IgnoreRule;
  readonly path: string;
}

export type Token =
  | { readonly kind: "byte"; readonly byte: number }
  | { readonly kind: "one" }
  | { readonly kind: "set"; readonly members: Uint8Array }
  | { readonly kind: "star" }
  | { readonly kind: "dirs" }
  | { readonly kind: "cross" };

const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const HASH = 0x23;
const STAR = 0x2a;
const DASH = 0x2d;
const SLASH = 0x2f;
const COLON = 0x3a;
const QUESTION = 0x3f;
const OPEN = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE = 0x5d;
const CARET = 0x5e;

const ONE: Token = { kind: "one" };
const ANY_RUN: Token = { kind: "star" };
const DIRS: Token = { kind: "dirs" };
const CROSS: Token = { kind: "cross" };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const between = (byte: number, low: number, high: number) => byte >= low && byte <= high;
const isUpper = (byte: number) => between(byte, 0x41, 0x5a);
const isLower = (byte: number) => between(byte, 0x61, 0x7a);
const isDigit = (byte: number) => between(byte, 0x30, 0x39);
const isAlpha = (byte: number) => isUpper(byte) || isLower(byte);
const isGraph = (byte: number) => between(byte, 0x21, 0x7e);

/**
 * The classes a set may name, over ASCII only. Git's `space` was seen to
 * hold tab, LF, CR and space (not vertical tab or form feed).
 */
const CLASSES: Record<string, (byte: number) => boolean> = {
  alnum: (byte) => isAlpha(byte) || isDigit(byte),
  alpha: isAlpha,
  blank: (byte) => byte === SPACE || byte === 0x09,
  cntrl: (byte) => byte < 0x20 || byte === 0x7f,
  digit: isDigit,
  graph: isGraph,
  lower: isLower,
  print: (byte) => between(byte, 0x20, 0x7e),
  punct: (byte) => isGraph(byte) && !isAlpha(byte) && !isDigit(byte),
  space: (byte) => byte === SPACE || byte === 0x09 || byte === LF || byte === CR,
  upper: isUpper,
  xdigit: (byte) => isDigit(byte) || between(byte, 0x41, 0x46) || between(byte, 0x61, 0x66),
};

/**
 * Reads the set that starts after a `[` at `start`: its 256 members and
 * where the pattern goes on, or null when the set is unclosed or names an
 * unknown class.
 */
function readSet(pattern: Uint8Array, start: number): { members: Uint8Array; next: number } | null {
  const members = new Uint8Array(256);
  let index = start;
  const negated = pattern[index] === BANG || pattern[index] === CARET;
  if (negated) index += 1;
  let first = true;
  // The last single byte, which a following `-` turns into a range's start.
  let previous = -1;
  for (;;) {
    const byte = pattern[index];
    if (byte === undefined) return null;
    if (byte === CLOSE && !first) {
      index += 1;
      break;
    }
    first = false;
    if (byte === BACKSLASH) {
      const escaped = pattern[index + 1];
      if (escaped === undefined) return null;
      members[escaped] = 1;
      previous = escaped;
      index += 2;
      continue;
    }
    const after = pattern[index + 1];
    if (byte === DASH && previous >= 0 && after !== undefined && after !== CLOSE) {
      let last = after;
      let next = index + 2;
      if (last === BACKSLASH) {
        const escaped = pattern[index + 2];
        if (escaped === undefined) return null;
        last = escaped;
        next = index + 3;
      }
      for (let member = previous; member <= last; member += 1) members[member] = 1;
      previous = -1;
      index = next;
      continue;
    }
    if (byte === OPEN && after === COLON) {
      // `[:name:]`, closed by the first `]` after the name when a `:` comes
      // right before it; otherwise the `[` is a member like any other byte.
      const close = pattern.indexOf(CLOSE, index + 2);
      if (close > index + 2 && pattern[close - 1] === COLON) {
        const test = CLASSES[decoder.decode(pattern.subarray(index + 2, close - 1))];
        if (!test) return null;
        for (let member = 0; member < 256; member += 1) if (test(member)) members[member] = 1;
        previous = -1;
        index = close + 1;
        continue;
      }
    }
    members[byte] = 1;
    previous = byte;
    index += 1;
  }
  if (negated) {
    for (let member = 0; member < 256; member += 1) members[member] = members[member] ? 0 : 1;
  }
  return { members, next: index };
}

// Compiles a pattern into tokens, or null when it can match nothing.
//
// With `pathname`, wildcards stop at `/` and whole-part `**` cross it. Git
// compares the literal beginning of a rule, up to its first `*`, `?`, `[`
// or `\`, on its own and matches the rest as a pattern that starts there:
// so `a**/b` is `a` followed by `**/b`, which may cross a slash from the
// middle of a name, while in `*a**/b` the `**` is a plain `*`. Black-box
// comparisons with Git showed exactly this, so a `**` right after the
// literal beginning counts as starting a part. A whole-part `**` before an
// escaped slash `\/` crosses slashes but is no `**/`: `a/**\/b` needs a
// directory between `a` and `b`, as Git was seen to require.
function compile(pattern: Uint8Array, pathname: boolean): Token[] | null {
  let literal = 0;
  while (literal < pattern.length) {
    const byte = pattern[literal];
    if (byte === STAR || byte === QUESTION || byte === OPEN || byte === BACKSLASH) break;
    literal += 1;
  }
  const tokens: Token[] = [];
  let index = 0;
  while (index < pattern.length) {
    const byte = pattern[index] as number;
    if (byte === BACKSLASH) {
      const escaped = pattern[index + 1];
      if (escaped === undefined) return null;
      tokens.push({ kind: "byte", byte: escaped });
      index += 2;
    } else if (byte === QUESTION) {
      tokens.push(ONE);
      index += 1;
    } else if (byte === OPEN) {
      const set = readSet(pattern, index + 1);
      if (!set) return null;
      tokens.push({ kind: "set", members: set.members });
      index = set.next;
    } else if (byte === STAR) {
      let end = index;
      while (pattern[end] === STAR) end += 1;
      const opens = index === literal || pattern[index - 1] === SLASH;
      const slash = pattern[end] === SLASH;
      const closes =
        slash ||
        end === pattern.length ||
        (pattern[end] === BACKSLASH && pattern[end + 1] === SLASH);
      if (pathname && end - index >= 2 && opens && closes) {
        tokens.push(slash ? DIRS : CROSS);
        index = slash ? end + 1 : end;
      } else {
        tokens.push(ANY_RUN);
        index = end;
      }
    } else {
      tokens.push({ kind: "byte", byte });
      index += 1;
    }
  }
  return tokens;
}

/** Whether the tokens match the whole text: a search over (token, byte) pairs, each tried once. */
function matches(tokens: readonly Token[], text: Uint8Array, pathname: boolean): boolean {
  const width = text.length + 1;
  // 0: not tried yet, 1: matches, 2: does not.
  const known = new Uint8Array((tokens.length + 1) * width);
  const from = (at: number, offset: number): boolean => {
    const key = at * width + offset;
    const answer = known[key];
    if (answer) return answer === 1;
    const result = step(at, offset);
    known[key] = result ? 1 : 2;
    return result;
  };
  const step = (at: number, offset: number): boolean => {
    const token = tokens[at];
    if (!token) return offset === text.length;
    const byte = text[offset];
    switch (token.kind) {
      case "byte":
        return byte === token.byte && from(at + 1, offset + 1);
      case "one":
        return byte !== undefined && !(pathname && byte === SLASH) && from(at + 1, offset + 1);
      case "set":
        return (
          byte !== undefined &&
          !(pathname && byte === SLASH) &&
          token.members[byte] === 1 &&
          from(at + 1, offset + 1)
        );
      case "star":
        for (let end = offset; ; end += 1) {
          if (from(at + 1, end)) return true;
          const next = text[end];
          if (next === undefined || (pathname && next === SLASH)) return false;
        }
      case "dirs":
        // Nothing, or everything up to and including a later `/`.
        if (from(at + 1, offset)) return true;
        for (let end = offset; end < text.length; end += 1) {
          if (text[end] === SLASH && from(at + 1, end + 1)) return true;
        }
        return false;
      case "cross":
        for (let end = offset; end <= text.length; end += 1) if (from(at + 1, end)) return true;
        return false;
    }
  };
  return from(0, 0);
}

/**
 * Whether a glob pattern matches a whole text, both as bytes. With
 * `pathname`, wildcards do not match `/` and whole-part `**` do, as in a
 * rule with a slash.
 */
export function wildmatch(pattern: Uint8Array, text: Uint8Array, pathname: boolean): boolean {
  const tokens = compile(pattern, pathname);
  return tokens !== null && matches(tokens, text, pathname);
}

/** The end of a line without its trailing spaces; a `\` keeps the byte after it. */
function trimmedEnd(line: Uint8Array, length: number): number {
  let end = 0;
  let index = 0;
  while (index < length) {
    if (line[index] === BACKSLASH && index + 1 < length) {
      index += 2;
      end = index;
    } else {
      if (line[index] !== SPACE) end = index + 1;
      index += 1;
    }
  }
  return end;
}

function parseLine(line: Uint8Array, source: string, number: number): IgnoreRule | null {
  const length = line[line.length - 1] === CR ? line.length - 1 : line.length;
  const text = line.subarray(0, trimmedEnd(line, length));
  if (text.length === 0 || text[0] === HASH) return null;
  let body = text;
  const negated = body[0] === BANG;
  if (negated) body = body.subarray(1);
  const directoryOnly = body[body.length - 1] === SLASH;
  if (directoryOnly) body = body.subarray(0, body.length - 1);
  const nameOnly = !body.includes(SLASH);
  if (!nameOnly && body[0] === SLASH) body = body.subarray(1);
  // `!`, `/` or `!/` alone: nothing to match.
  if (body.length === 0) return null;
  return {
    pattern: decoder.decode(text),
    source,
    line: number,
    negated,
    directoryOnly,
    nameOnly,
    tokens: compile(body, true),
  };
}

/** The rules of one rule file, in order; `source` is how messages name the file. */
export function parseIgnoreFile(content: Uint8Array | string, source: string): IgnoreRule[] {
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  const rules: IgnoreRule[] = [];
  let start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let number = 0;
  while (start <= bytes.length) {
    const found = bytes.indexOf(LF, start);
    const end = found < 0 ? bytes.length : found;
    number += 1;
    const rule = parseLine(bytes.subarray(start, end), source, number);
    if (rule) rules.push(rule);
    start = end + 1;
  }
  return rules;
}

/**
 * The rule that decides a path, or null when none matches. `levels` go from
 * the deepest rule file to the shallowest, `.git/info/exclude` last: the
 * first level with a matching rule decides, and within a level the last
 * matching rule. Whether a directory above the path is excluded is the
 * caller's walk (`IgnoreRules` in `src/data/files.ts`).
 */
export function decide(
  levels: readonly IgnoreLevel[],
  path: string,
  isDirectory: boolean,
): IgnoreDecision | null {
  for (const level of levels) {
    let relative: string;
    if (level.base === "") relative = path;
    else if (path.startsWith(`${level.base}/`)) relative = path.slice(level.base.length + 1);
    else continue;
    const whole = encoder.encode(relative);
    const name = encoder.encode(relative.slice(relative.lastIndexOf("/") + 1));
    for (let index = level.rules.length - 1; index >= 0; index -= 1) {
      const rule = level.rules[index];
      if (!rule?.tokens || (rule.directoryOnly && !isDirectory)) continue;
      if (matches(rule.tokens, rule.nameOnly ? name : whole, true)) {
        return { ignored: !rule.negated, rule, path };
      }
    }
  }
  return null;
}
