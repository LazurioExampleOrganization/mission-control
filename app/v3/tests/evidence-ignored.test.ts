import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "@lazurio/repository-db";
import { validateRepository } from "../../../templates/data-repo/scripts/validate.ts";
import { readDataDirectory } from "../src/data/directory.ts";
import {
  checkData,
  collectDataFiles,
  type DataReader,
  directoryReader,
  parseDataFiles,
} from "../src/data/files.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { at, cleanupDataRepos, codes, dataRepo, edit, link, ROADMAP } from "./support/data-repo.ts";
import { createFixtureRepo, git } from "./support/fixture-repo.ts";

// Evidence that Git's ignore rules leave out of every commit is refused
// (LazurioTemplates/mission-control#24): repository-db validates a publish
// before `git add --all`, which would leave the file out, so the published
// commit would cite evidence it does not contain. The rules are read from the
// checkout, never asked of Git, so the App, the validator before a publish
// and CI give one answer.
setDefaultTimeout(60_000);
cleanupDataRepos();

/**
 * Writes an evidence file and names it as the evidence of RM-0001's done step.
 * New evidence lives outside `data/mission-control/`, where every file beside
 * the records is the frozen 3.x history.
 */
function cite(root: string, path: string, roadmap = ROADMAP) {
  mkdirSync(join(at(root, path), ".."), { recursive: true });
  writeFileSync(at(root, path), "Proof of the step.\n");
  edit(root, roadmap, (value) => {
    value.steps[0].evidence_refs[0].path = path;
  });
}

/** The validator's issues, after checking that the App's check says the same. */
async function check(root: string) {
  const validator = await validateRepository(root);
  expect(codes(readDataDirectory(root).problems)).toEqual(codes(validator));
  return validator;
}

const ignoredBy = (issues: readonly { code: string; params?: Record<string, string> }[]) =>
  issues
    .filter((issue) => issue.code === "evidence_ignored")
    .map((issue) => [
      issue.params?.path,
      issue.params?.ignored,
      issue.params?.pattern,
      issue.params?.source,
    ]);

describe("evidence Git leaves out of every commit", () => {
  test("a file a rule of the root .gitignore leaves out", async () => {
    const root = dataRepo("en");
    appendFileSync(at(root, ".gitignore"), "*.secret\n");
    const proof = "evidence/proof.secret";
    cite(root, proof);
    const issues = await check(root);
    expect(codes(issues)).toEqual(["RM-0001 evidence_ignored"]);
    expect(ignoredBy(issues)).toEqual([[proof, proof, "*.secret", ".gitignore"]]);
  });

  test("a file under an excluded directory, even with a rule that re-includes it", async () => {
    const root = dataRepo("en");
    appendFileSync(at(root, ".gitignore"), "private/\n!evidence/private/proof.md\n");
    const proof = "evidence/private/proof.md";
    cite(root, proof);
    expect(ignoredBy(await check(root))).toEqual([
      [proof, "evidence/private", "private/", ".gitignore"],
    ]);
  });

  test("a reversed bracket range, as Git reads it", async () => {
    const root = dataRepo("en");
    appendFileSync(at(root, ".gitignore"), "[z-a]*.secret\n");
    const proof = "evidence/z.secret";
    cite(root, proof);
    expect(ignoredBy(await check(root))).toEqual([[proof, proof, "[z-a]*.secret", ".gitignore"]]);
    // It matches its first character only.
    cite(root, "evidence/m.secret");
    expect(await check(root)).toEqual([]);
  });

  test("a rule of a nested .gitignore", async () => {
    const root = dataRepo("en");
    const proof = "evidence/proof.md";
    cite(root, proof);
    writeFileSync(at(root, "evidence/.gitignore"), "*.md\n");
    expect(ignoredBy(await check(root))).toEqual([[proof, proof, "*.md", "evidence/.gitignore"]]);
  });

  test("a negated rule lets the file in, also from a deeper .gitignore", async () => {
    const root = dataRepo("en");
    appendFileSync(at(root, ".gitignore"), "*.secret\n!keep.secret\n");
    cite(root, "evidence/keep.secret");
    expect(await check(root)).toEqual([]);
    cite(root, "evidence/proof.secret");
    writeFileSync(at(root, "evidence/.gitignore"), "!proof.secret\n");
    expect(await check(root)).toEqual([]);
  });

  test("a new file of the same draft that no rule leaves out passes in the App and the validator", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      cite(fixture.mountRoot, "evidence/new-proof.md");
      // Neither tracked nor staged: what repository-db validates before a publish.
      expect(git(fixture.mountRoot, ["status", "--porcelain", "--", "evidence"])).toContain(
        "?? evidence/",
      );
      expect(await store.check()).toEqual([]);
      expect(await validateRepository(fixture.mountRoot)).toEqual([]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a nested .gitignore that is not published itself cannot let evidence in", async () => {
    // The review's case: the tracked root ignores *.secret and every nested
    // .gitignore; an untracked evidence/.gitignore re-includes the proof.
    const fixture = createFixtureRepo({ sample: true });
    try {
      const root = fixture.mountRoot;
      appendFileSync(at(root, ".gitignore"), "*.secret\n");
      git(root, ["commit", "--quiet", "--all", "--message", "ignore secrets"]);
      appendFileSync(at(root, ".gitignore"), "**/.gitignore\n");
      git(root, ["commit", "--quiet", "--all", "--message", "ignore nested rule files"]);
      const proof = "evidence/proof.secret";
      cite(root, proof);
      writeFileSync(at(root, "evidence/.gitignore"), "!proof.secret\n");
      // Here, Git takes the proof and leaves the nested rule file out.
      expect(git(root, ["status", "--porcelain", "--untracked-files=all", "--", "evidence"])).toBe(
        `?? ${proof}`,
      );
      const issues = await check(root);
      expect(ignoredBy(issues)).toEqual([[proof, proof, "*.secret", ".gitignore"]]);
      expect(issues[0]?.params?.unpublished).toBe("evidence/.gitignore");

      // The published checkout says the same: without the nested rule file,
      // the root rule refuses the proof there too.
      git(root, ["add", "--all"]);
      git(root, ["commit", "--quiet", "--message", "publish"]);
      const published = join(fixture.root, "published");
      git(fixture.root, ["clone", "--quiet", root, published]);
      const there = await validateRepository(published);
      expect(codes(there)).toEqual(["RM-0001 evidence_ignored"]);
      expect(ignoredBy(there)).toEqual([[proof, proof, "*.secret", ".gitignore"]]);
    } finally {
      fixture.cleanup();
    }
  });

  test("a published nested .gitignore lets evidence in, here and on the published checkout", async () => {
    const fixture = createFixtureRepo({ sample: true });
    try {
      const root = fixture.mountRoot;
      appendFileSync(at(root, ".gitignore"), "*.secret\n");
      const proof = "evidence/proof.secret";
      cite(root, proof);
      writeFileSync(at(root, "evidence/.gitignore"), "!proof.secret\n");
      expect(await check(root)).toEqual([]);
      git(root, ["add", "--all"]);
      git(root, ["commit", "--quiet", "--message", "publish"]);
      const published = join(fixture.root, "published");
      git(fixture.root, ["clone", "--quiet", root, published]);
      expect(await validateRepository(published)).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  test(".git/info/exclude of the checkout counts, in a clone and in a linked worktree", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      appendFileSync(at(fixture.mountRoot, ".git/info/exclude"), "*.draft\n");
      const proof = "evidence/proof.draft";
      cite(fixture.mountRoot, proof);
      const app = await store.check();
      expect(codes(app)).toEqual(codes(await validateRepository(fixture.mountRoot)));
      expect(ignoredBy(app)).toEqual([[proof, proof, "*.draft", ".git/info/exclude"]]);
      // Git leaves it out indeed.
      expect(git(fixture.mountRoot, ["status", "--porcelain", "--", proof])).toBe("");

      const worktree = join(fixture.root, "pull-request");
      git(fixture.mountRoot, ["worktree", "add", "--quiet", "--detach", worktree]);
      cite(worktree, proof);
      expect(ignoredBy(await validateRepository(worktree))).toEqual([
        [proof, proof, "*.draft", ".git/info/exclude"],
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a .gitignore that cannot be read stops the check instead of passing", () => {
    const root = dataRepo("en");
    const proof = "evidence/proof.md";
    cite(root, proof);
    writeFileSync(at(root, "evidence/.gitignore"), "!proof.md\n");
    const disk = directoryReader(root);
    const reader: DataReader = {
      kind: (path) => disk.kind(path),
      list: (path) => disk.list(path),
      bytes: (path) => (path === "evidence/.gitignore" ? { failed: "EIO" } : disk.bytes(path)),
    };
    expect(codes(checkData(reader, parseDataFiles(collectDataFiles(reader), parseYaml)))).toEqual([
      "evidence/.gitignore read_failed",
    ]);
  });

  test("an exclude file that cannot be read stops the check instead of passing", () => {
    const root = dataRepo("en");
    const disk = directoryReader(root);
    const reader: DataReader = { ...disk, gitInfoExclude: () => ({ failed: "EACCES" }) };
    expect(codes(checkData(reader, parseDataFiles(collectDataFiles(reader), parseYaml)))).toEqual([
      ".git/info/exclude read_failed",
    ]);
  });

  test("a .gitignore that is a symbolic link is refused, not read", async () => {
    const root = dataRepo("en");
    const elsewhere = dataRepo("en");
    writeFileSync(at(elsewhere, "rules"), "!*\n");
    const proof = "evidence/proof.md";
    cite(root, proof);
    if (!link(at(elsewhere, "rules"), at(root, "evidence/.gitignore"), "file")) {
      console.warn("skipped: this platform did not create a file link");
      return;
    }
    expect(codes(await check(root))).toEqual(["evidence/.gitignore link_refused"]);
    rmSync(at(root, "evidence/.gitignore"));
    expect(await check(root)).toEqual([]);
  });
});
