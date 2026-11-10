import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { directoryReader, IgnoreRules } from "../src/data/files.ts";
import { decide, type IgnoreDialect, parseIgnoreFile, wildmatch } from "../src/domain/gitignore.ts";

// The ignore rules without Git (`src/domain/gitignore.ts`), compared with Git
// as a black box. Every expected answer here comes from Git while the test
// runs: what `git ls-files --others --exclude-standard` lists is what `git add
// --all` takes, and anything it does not list is ignored. That is the
// evidence the matcher behaves like Git; it was written from Git's
// documentation and these answers, not from Git's code.
//
// Git versions read a `**` glued to a name differently (`IgnoreDialect`):
// each comparison uses the reading of the Git that runs the test, found by
// asking it, and the check itself refuses what either reading leaves out.
//
// `MC_IGNORE_ROUNDS=<n>` sets how many generated cases run (CI: the default),
// `MC_IGNORE_SEED=<n>` replays one.

// Every case is a Git repository; on a Windows runner that takes a while.
setDefaultTimeout(300_000);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** An empty repository: names compared case-sensitively, no machine-wide exclude file. */
function repository(): string {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), "mission-control-ignore-"));
  roots.push(root);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "core.ignorecase", "false"]);
  git(root, ["config", "core.quotepath", "false"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(root, ".git", "no-global-excludes"), "");
  git(root, ["config", "core.excludesFile", join(root, ".git", "no-global-excludes")]);
  return root;
}

function write(root: string, path: string, content: string | Uint8Array = "x\n") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** The untracked files Git would add: everything its ignore rules leave in. */
const listed = (root: string) =>
  new Set(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"));

// How the Git running this test reads `a**/b`: does it leave out `a/x/b`?
function dialectOfGit(): IgnoreDialect {
  const root = repository();
  write(root, ".gitignore", "a**/b\n");
  write(root, "a/x/b");
  write(root, "a/b");
  const kept = listed(root);
  // Both readings leave out `a/b`; otherwise the probe itself is wrong.
  if (kept.has("a/b")) throw new Error("git ls-files did not apply a**/b at all");
  return kept.has("a/x/b") ? "documented" : "legacy";
}
const DIALECT = dialectOfGit();

/** The paths Git leaves out, and the paths our rules leave out in its reading. */
function compare(root: string, paths: readonly string[]) {
  const kept = listed(root);
  const rules = new IgnoreRules(directoryReader(root));
  const sorted = [...paths].sort();
  const result = {
    git: sorted.filter((path) => !kept.has(path)),
    ours: sorted.filter((path) => rules.explain(path, [DIALECT]).local !== null),
  };
  expect(rules.issues).toEqual([]);
  return result;
}

/** A small seeded generator, so a failing case can be replayed by its seed. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  return { next, pick, chance: (p: number) => next() < p };
}

// Characters a name may hold on every runner, and those only POSIX file
// systems take. Patterns use all of them either way.
const WINDOWS = process.platform === "win32";
const NAME_CHARS = [
  ...["a", "b", "c", "x", "Z", "0", "-", ".", "_", "[", "]", "!", "#", "^", "é"],
  ...(WINDOWS ? [] : [" ", "*", "?", "\\", ":"]),
];
const PATTERN_CHARS = [...NAME_CHARS, " ", "*", "?", "\\", ":"];

// Sets, the awkward ones included: reversed and boundary ranges, `]` and `-`
// at every place, escapes, classes known and unknown, unclosed ones.
const SETS = [
  "[a-c]",
  "[z-a]",
  "[c-a-e]",
  "[a-]",
  "[-a]",
  "[--0]",
  "[]a]",
  "[]-a]",
  "[!]-a]",
  "[]-]",
  "[!a]",
  "[^a-z]",
  "[!-]",
  "[!z-a]",
  "[\\]a]",
  "[\\\\]",
  "[a\\-c]",
  "[\\--0]",
  "[\\[-\\]]",
  "[a-\\]]",
  "[a-[:digit:]]",
  "[[:alpha:]]",
  "[[:digit:]-z]",
  "[[:alpha:]a-c]",
  "[[:punct:]]",
  "[[:space:]]",
  "[[:upper:][:digit:]]",
  "[[:foo:]]",
  "[[:foo:]a]",
  "[a[:foo:]]",
  "[![:foo:]]",
  "[[:DIGIT:]]",
  "[[:cntrl:]]",
  "[[:blank:]]",
  "[[:alpha:]",
  "[[:digit]",
  "[[:]a]",
  "[[:a]x:]]",
  "[[=a=]]",
  "[[]",
  "[:alpha:]",
  "[a",
  "[!]",
  "[\\]",
  "[é]",
  "[a-é]",
  "[*?]",
  "[ -!]",
];

const ROUNDS = Number(process.env.MC_IGNORE_ROUNDS ?? 40);
const FIRST = Number(process.env.MC_IGNORE_SEED ?? 1);
const LAST = process.env.MC_IGNORE_SEED ? FIRST : FIRST + ROUNDS - 1;

describe("the ignore rules compared with Git", () => {
  test("fixed rules: anchors, directories, negations, sets, escapes and **", () => {
    const root = repository();
    write(
      root,
      ".gitignore",
      [
        "# a comment",
        "*.secret",
        "!keep.secret",
        ".env*",
        "build/",
        "!build/keep.txt",
        "**/oauth/**",
        "/rooted.txt",
        "docs/*.md",
        "a/**/b.txt",
        "[Tt]emp*",
        "[z-a]*.key",
        "file[!0-9].txt",
        "v[[:digit:]].txt",
        "\\#hash.txt",
        "\\!bang.txt",
        "trailing.txt   ",
        "cache/",
        "logs/**",
        "!logs/keep.log",
        "foo**bar",
        "x**/y.txt",
        "deep/**/",
        "",
      ].join("\n"),
    );
    write(root, "sub/.gitignore", "!*.secret\n/local.txt\nnested/\n!final.pdf\n*.pdf\n");
    write(root, "sub/inner/.gitignore", "!final.pdf\n");
    // Inside an excluded directory: Git never reads it.
    write(root, "build/.gitignore", "!*\n");
    write(root, ".git/info/exclude", "*.local\n!override.local\n");
    const paths = [
      "a.secret",
      "keep.secret",
      "sub/a.secret",
      ".env",
      ".env.local",
      "env.txt",
      "build/x.txt",
      "build/keep.txt",
      "build/.gitignore",
      "sub/build/y.txt",
      "oauth/token.json",
      "sub/oauth/t.json",
      "oauthx/t.json",
      "rooted.txt",
      "sub/rooted.txt",
      "docs/readme.md",
      "docs/sub/readme.md",
      "a/b.txt",
      "a/x/y/b.txt",
      "a/c.txt",
      "Temp1.txt",
      "temp2.txt",
      "z.key",
      "a.key",
      "m.key",
      "filea.txt",
      "file1.txt",
      "v1.txt",
      "vv.txt",
      "#hash.txt",
      "!bang.txt",
      "trailing.txt",
      "cache/c.txt",
      "sub/cache",
      "logs/a.txt",
      "logs/keep.log",
      "foobar",
      "foo-x-bar",
      "x/y.txt",
      "xa/b/y.txt",
      "xy.txt",
      "deep/a/x.txt",
      "deep/y.txt",
      "sub/local.txt",
      "sub/inner/local.txt",
      "sub/nested/n.txt",
      "sub/report.pdf",
      "sub/final.pdf",
      "sub/inner/final.pdf",
      "y.local",
      "override.local",
      "sub/.gitignore",
      "sub/inner/.gitignore",
    ];
    for (const path of paths) if (!path.endsWith(".gitignore")) write(root, path);
    const { git: leftOut, ours } = compare(root, [...paths, ".gitignore"]);
    expect(ours).toEqual(leftOut);
    // The corpus exercises both answers.
    expect(leftOut.length).toBeGreaterThan(15);
    expect(paths.length - leftOut.length).toBeGreaterThan(15);
  });

  test("a rule file is read line by line as Git reads it", () => {
    const root = repository();
    const names = [
      "a",
      "b",
      "c",
      "#a",
      "!a",
      "ab",
      ...(WINDOWS ? [] : ["a ", "a  ", "a\\", "a\\ ", "a\t", "a\r", " a", "\ta", "a\rb"]),
    ];
    const files: (string | Uint8Array)[] = [
      "a   \n",
      "a\\ \n",
      "a\\   \n",
      "a\\ \\ \n",
      "a\\\\ \n",
      "a\\\\\\ \n",
      "a\t\n",
      "a\r\nb\r\n",
      "a\r\r\n",
      "a\rb\n",
      "c\r",
      "c",
      "a \r\n",
      "a\r \n",
      new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0a]),
      new Uint8Array([0x62, 0x0a, 0xef, 0xbb, 0xbf, 0x61, 0x0a]),
      "#a\n",
      "\\#a\n",
      " #a\n",
      "*\n!\n",
      "*\n!/\n",
      "\\!a\n",
      "!!a\n*\n!!a\n",
      "\\\n",
      "a\\\n",
      "\\a\n",
      " a\n",
      "\ta\n",
      "/\n",
      "   \n",
      "\\ \n",
      "a #c\n",
      "*\n!a\n#!b\n",
    ];
    const paths: string[] = [];
    files.forEach((content, index) => {
      write(root, `case${index}/.gitignore`, content);
      for (const name of names) {
        write(root, `case${index}/${name}`);
        paths.push(`case${index}/${name}`);
      }
    });
    const { git: leftOut, ours } = compare(root, paths);
    expect(ours).toEqual(leftOut);
    expect(leftOut.length).toBeGreaterThan(30);
  });

  test("every set against every byte a name can hold", () => {
    const root = repository();
    const forbidden = WINDOWS ? '\\/:*?"<>|' : "/";
    const bytes: string[] = [];
    // Control bytes, LF included, only where a name may hold them.
    for (let code = WINDOWS ? 0x20 : 0x01; code <= 0x7f; code += 1) {
      const char = String.fromCharCode(code);
      if (!forbidden.includes(char)) bytes.push(char);
    }
    bytes.push("é");
    const paths: string[] = [];
    SETS.forEach((set, index) => {
      // Upper-case names in a directory of their own: Windows would take
      // `qAq` and `qaq` for one file.
      for (const directory of [`set${index}`, `set${index}u`]) {
        write(root, `${directory}/.gitignore`, `q${set}q\n`);
      }
      for (const char of bytes) {
        const path = `set${index}${/[A-Z]/.test(char) ? "u" : ""}/q${char}q`;
        write(root, path);
        paths.push(path);
      }
    });
    const { git: leftOut, ours } = compare(root, paths);
    expect(ours).toEqual(leftOut);
    // The exported matcher answers the same for a rule's pattern and a name.
    const encode = (text: string) => new TextEncoder().encode(text);
    const matched = paths.filter((path) => {
      const [directory = "", name = ""] = path.split("/");
      const set = SETS[Number.parseInt(directory.slice(3), 10)] ?? "";
      return wildmatch(encode(`q${set}q`), encode(name), true, DIALECT);
    });
    expect(matched).toEqual(paths.filter((path) => leftOut.includes(path)));
  });

  test("stars: ** at every position, after a literal beginning, next to escaped slashes", () => {
    // Each pattern in a directory of its own, with every directory re-included
    // (`!*/`), so the pattern alone decides each file.
    const STARS = [
      "**/foo",
      "***/foo",
      "a/***/foo",
      "a/***",
      "***",
      "**",
      "/**",
      "**/",
      "a/**/b",
      "a/**/**/e",
      "**/**/foo",
      "*/foo",
      "*/**/e",
      "**foo",
      "a**",
      "a**/e",
      "a**e",
      "a**/foo",
      "a/**foo",
      "a/**e",
      "x/a**/b",
      "ab**/e",
      "a***e",
      "*a**",
      "*a**/e",
      "?a**/e",
      "a*/**/e",
      "*a/**/e",
      "[a]b**/e",
      "\\*a**/e",
      "a\\b**/e",
      "*\\b",
      "a\\/**/foo",
      "a\\/b",
      "\\/foo",
      "\\/**/b",
      "*\\/b",
      "**\\/b",
      "***\\/b",
      "a**\\/b",
      "a/**\\/b",
      "a\\/**",
      "a\\/**\\/**\\/e",
      "**\\/**",
      "**\\/",
      "a/**\\",
      "foo\\/",
      "//foo",
      "foo//",
      "a[/]b",
    ];
    const DIRECTORIES = ["", "a/", "x/", "ab/", "foo/", "a/x/", "x/a/", "ab/foo/", "a/a/"];
    const LEAVES = ["b", "e", "foo", "ae", "abe", "a"];
    const root = repository();
    const paths: string[] = [];
    STARS.forEach((pattern, index) => {
      write(root, `stars${index}/.gitignore`, `${pattern}\n!*/\n`);
      for (const directory of DIRECTORIES) {
        for (const leaf of LEAVES) {
          const path = `stars${index}/${directory}${leaf}`;
          // A name that is a directory elsewhere stays a directory.
          if (DIRECTORIES.includes(`${directory}${leaf}/`)) continue;
          write(root, path);
          paths.push(path);
        }
      }
    });
    const { git: leftOut, ours } = compare(root, paths);
    expect(ours).toEqual(leftOut);
    expect(leftOut.length).toBeGreaterThan(STARS.length * 3);
  });

  test("evidence that either reading of a glued ** leaves out is refused", () => {
    const root = repository();
    // `x**/y.txt`: Git 2.43 also leaves out `xa/b/y.txt`, Git 2.56 does not;
    // `!z**/y.txt` re-includes `za/b/y.txt` in Git 2.43 only.
    write(root, ".gitignore", "x**/y.txt\n*.md\n!z**/y.md\n");
    for (const path of ["xa/b/y.txt", "xa/y.txt", "za/b/y.md", "za/y.md", "w/y.txt"]) {
      write(root, path);
    }
    const rules = new IgnoreRules(directoryReader(root));
    const view = (path: string, dialect: IgnoreDialect) =>
      rules.explain(path, [dialect]).local?.rule.pattern ?? null;
    expect(view("xa/b/y.txt", "legacy")).toBe("x**/y.txt");
    expect(view("xa/b/y.txt", "documented")).toBeNull();
    expect(view("za/b/y.md", "legacy")).toBeNull();
    expect(view("za/b/y.md", "documented")).toBe("*.md");
    const refused = ["xa/b/y.txt", "xa/y.txt", "za/b/y.md", "za/y.md", "w/y.txt"].filter((path) =>
      rules.ignoredFile(path),
    );
    expect(refused).toEqual(["xa/b/y.txt", "xa/y.txt", "za/b/y.md"]);
    // The Git running this test agrees with its own reading.
    const kept = listed(root);
    expect(["xa/b/y.txt", "za/b/y.md"].filter((path) => !kept.has(path))).toEqual(
      DIALECT === "legacy" ? ["xa/b/y.txt"] : ["za/b/y.md"],
    );
    expect(rules.issues).toEqual([]);
  });

  test("a deeper .gitignore decides before a shallower one and before info/exclude", () => {
    const root = { base: "", rules: parseIgnoreFile("*.secret\n", ".gitignore") };
    const sub = { base: "sub", rules: parseIgnoreFile("!*.secret\n", "sub/.gitignore") };
    const exclude = { base: "", rules: parseIgnoreFile("*.txt\n", ".git/info/exclude") };
    expect(decide([sub, root, exclude], "sub/a.secret", false)?.ignored).toBe(false);
    expect(decide([sub, root, exclude], "a.secret", false)?.ignored).toBe(true);
    expect(decide([sub, root, exclude], "sub/a.txt", false)?.rule.source).toBe(".git/info/exclude");
    expect(decide([sub, root, exclude], "a.md", false)).toBeNull();
    expect(decide([sub, root, exclude], "sub/a.secret", false)?.rule).toMatchObject({
      pattern: "!*.secret",
      source: "sub/.gitignore",
      line: 1,
      negated: true,
    });
  });
});

/** A random rule over the names of a tree. */
function ruleMaker(r: ReturnType<typeof random>, names: readonly string[]) {
  const atom = (): string => {
    const roll = r.next();
    if (roll < 0.22) return r.pick(names);
    if (roll < 0.36) return "*";
    if (roll < 0.44) return "?";
    if (roll < 0.56) return r.pick(SETS);
    if (roll < 0.64) return `\\${r.pick([...PATTERN_CHARS, "/"])}`;
    if (roll < 0.74) return r.pick(["**", "***"]);
    return r.pick(PATTERN_CHARS);
  };
  const part = () => {
    let text = "";
    const count = 1 + Math.floor(r.next() * 3);
    for (let index = 0; index < count; index += 1) text += atom();
    return text;
  };
  return (): string => {
    if (r.chance(0.05)) {
      return r.pick([".gitignore", "**/.gitignore", "!.gitignore", ".*", "!**/.gitignore", "*/"]);
    }
    const parts: string[] = [];
    const count = 1 + Math.floor(r.next() * 3);
    for (let index = 0; index < count; index += 1) {
      parts.push(r.chance(0.15) ? r.pick(["**", "***"]) : part());
    }
    let text = parts.join("/");
    if (r.chance(0.2)) text = `/${text}`;
    if (r.chance(0.2)) text = `${text}/`;
    if (r.chance(0.08)) text += r.pick(["  ", "\\ ", " \t", "\r"]);
    if (r.chance(0.3)) text = `!${text}`;
    if (r.chance(0.03)) text = `#${text}`;
    return text;
  };
}

interface Tree {
  files: string[];
  rules: Record<string, string>;
  exclude: string;
  /** Rule files committed before the rest: tracked, whatever the rules say later. */
  early: string[];
}

function generate(seed: number): Tree {
  const r = random(seed);
  const name = () => {
    let text = "";
    const length = 1 + Math.floor(r.next() * 3);
    for (let index = 0; index < length; index += 1) text += r.pick(NAME_CHARS);
    if ([".", "..", ".git", ".gitignore"].includes(text) || /[. ]$/.test(text)) text += "q";
    return text;
  };
  const dirs = [""];
  for (let index = 0; index < 4; index += 1) {
    const top = name();
    dirs.push(top);
    if (r.chance(0.7)) {
      const sub = `${top}/${name()}`;
      dirs.push(sub);
      if (r.chance(0.5)) dirs.push(`${sub}/${name()}`);
    }
  }
  const directories = [...new Set(dirs)];
  const files = new Set<string>();
  for (const dir of directories) {
    for (let index = 0; index < 4; index += 1) {
      const path = dir ? `${dir}/${name()}` : name();
      const clashes = directories.some((other) => other === path || other.startsWith(`${path}/`));
      if (!clashes) files.add(path);
    }
  }
  const names = [
    ...directories.flatMap((dir) => dir.split("/")),
    ...[...files].map((file) => file.slice(file.lastIndexOf("/") + 1)),
  ].filter(Boolean);
  const rule = ruleMaker(r, names);
  const ruleFile = (count: number) =>
    `${Array.from({ length: count }, rule).join(r.chance(0.1) ? "\r\n" : "\n")}\n`;
  const rules: Record<string, string> = { ".gitignore": ruleFile(3 + Math.floor(r.next() * 6)) };
  for (const dir of directories.slice(1)) {
    if (r.chance(0.45)) rules[`${dir}/.gitignore`] = ruleFile(1 + Math.floor(r.next() * 4));
  }
  if (r.chance(0.4)) {
    // An earlier review's case: the root ignores a file and every nested rule
    // file, and a nested rule file, not published itself, lets the file in.
    const nested = [...files].filter((file) => file.includes("/"));
    if (nested.length > 0) {
      const file = r.pick(nested);
      const dir = file.slice(0, file.lastIndexOf("/"));
      const base = file.slice(dir.length + 1).replace(/[[\]*?!#\\ ]/g, (c) => `\\${c}`);
      rules[".gitignore"] += `${base}\n${r.pick(["**/.gitignore", ".gitignore", ".*"])}\n`;
      rules[`${dir}/.gitignore`] = `${rules[`${dir}/.gitignore`] ?? ""}!${base}\n`;
    }
  }
  return {
    files: [...files].sort(),
    rules,
    exclude: r.chance(0.6) ? ruleFile(1 + Math.floor(r.next() * 3)) : "",
    early: Object.keys(rules).filter(() => r.chance(0.3)),
  };
}

/** A Git checkout of the tree; `early` rule files committed first, with other rules. */
function checkout(tree: Tree): string {
  const root = repository();
  if (tree.early.length > 0) {
    for (const path of tree.early) write(root, path, "# tracked before the rules below\n");
    // Names may hold `:` or glob characters: pathspecs taken literally.
    git(root, ["--literal-pathspecs", "add", "--force", "--", ...tree.early]);
    git(root, ["commit", "--quiet", "--message", "early rules"]);
  }
  for (const [path, text] of Object.entries(tree.rules)) write(root, path, text);
  for (const path of tree.files) write(root, path);
  write(root, ".git/info/exclude", tree.exclude);
  return root;
}

describe("generated rules compared with Git", () => {
  test(`${ROUNDS * 10} generated rule files: every rule shape against the names of a tree`, () => {
    // Many small cases side by side in one repository: each directory has
    // one rule file of up to four random rules and the files to decide.
    const root = repository();
    const paths: string[] = [];
    for (let seed = FIRST; seed <= LAST; seed += 1) {
      const tree = generate(seed);
      const names = tree.files.map((file) => file.slice(file.lastIndexOf("/") + 1));
      for (let variant = 0; variant < 10; variant += 1) {
        const r = random(seed * 7919 + variant);
        const rule = ruleMaker(r, names);
        const lines = Array.from({ length: 1 + Math.floor(r.next() * 4) }, rule);
        const directory = `case${seed}-${variant}`;
        write(root, `${directory}/.gitignore`, `${lines.join("\n")}\n`);
        for (const file of tree.files) {
          write(root, `${directory}/${file}`);
          paths.push(`${directory}/${file}`);
        }
      }
    }
    const { git: leftOut, ours } = compare(root, paths);
    expect(ours).toEqual(leftOut);
    expect(leftOut.length).toBeGreaterThan(ROUNDS * 20);
    expect(paths.length - leftOut.length).toBeGreaterThan(ROUNDS * 20);
  });

  test(`${ROUNDS} generated trees: the local view is what git add --all takes`, () => {
    let compared = 0;
    let ignored = 0;
    for (let seed = FIRST; seed <= LAST; seed += 1) {
      const tree = generate(seed);
      const root = checkout(tree);
      const untracked = [
        ...tree.files,
        ...Object.keys(tree.rules).filter((path) => !tree.early.includes(path)),
      ];
      const { git: leftOut, ours } = compare(root, untracked);
      expect({ seed, ignored: ours }).toEqual({ seed, ignored: leftOut });
      compared += untracked.length;
      ignored += leftOut.length;
      rmSync(root, { recursive: true, force: true });
    }
    // Enough of both answers to mean something.
    expect(compared).toBeGreaterThan(ROUNDS * 20);
    expect(ignored).toBeGreaterThan(ROUNDS * 3);
  });

  test(`${ROUNDS} generated trees: what the check passes here, the published commit holds and the check passes there`, () => {
    let passed = 0;
    let refusedOnlyForThePublishedView = 0;
    for (let seed = FIRST; seed <= LAST; seed += 1) {
      const tree = generate(seed);
      const root = checkout(tree);
      const here = new IgnoreRules(directoryReader(root));
      const passing = tree.files.filter((path) => !here.ignoredFile(path));
      refusedOnlyForThePublishedView += tree.files.filter((path) => {
        const view = here.explain(path);
        return !view.local && view.published;
      }).length;
      git(root, ["add", "--all"]);
      git(root, ["commit", "--quiet", "--allow-empty", "--message", "publish"]);
      const published = `${root}-published`;
      roots.push(published);
      git(root, ["clone", "--quiet", root, published]);
      const there = new IgnoreRules(directoryReader(published));
      for (const path of passing) {
        expect({
          seed,
          path,
          inCommit: existsSync(join(published, path)),
          there: there.ignoredFile(path)?.decision.rule.pattern ?? null,
        }).toEqual({ seed, path, inCommit: true, there: null });
      }
      expect(there.issues).toEqual([]);
      passed += passing.length;
      rmSync(root, { recursive: true, force: true });
      rmSync(published, { recursive: true, force: true });
    }
    expect(passed).toBeGreaterThan(ROUNDS * 5);
    // Some cases need the published view: a rule file that is not published lets a file in here.
    if (!process.env.MC_IGNORE_SEED) expect(refusedOnlyForThePublishedView).toBeGreaterThan(0);
  });
});
