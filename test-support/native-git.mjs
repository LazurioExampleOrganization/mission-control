import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

function environmentValue(env, name, platform) {
  if (platform !== "win32") return env[name];
  const entry = Object.entries(env).find(
    ([key]) => key.toUpperCase() === name.toUpperCase(),
  );
  return entry?.[1];
}

export function nativeGitExecutableCandidates({
  env = process.env,
  platform = process.platform,
  pathImplementation = platform === "win32" ? path.win32 : path.posix,
} = {}) {
  const pathValue = environmentValue(env, "PATH", platform);
  if (typeof pathValue !== "string" || pathValue.length === 0) return [];
  const executableName = platform === "win32" ? "git.exe" : "git";
  return pathValue
    .split(pathImplementation.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => pathImplementation.isAbsolute(entry))
    .map((entry) => pathImplementation.join(entry, executableName));
}

export function resolveNativeGitExecutable(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    candidates = nativeGitExecutableCandidates(options),
    canonicalize = realpathSync,
    assertAccessible = (candidate) =>
      accessSync(
        candidate,
        platform === "win32" ? constants.F_OK : constants.X_OK,
      ),
    assertRegularFile = (candidate) => {
      if (!statSync(candidate).isFile()) throw new Error("not a regular file");
    },
    probe = (candidate) =>
      execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        env: { ...env },
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
  } = options;

  for (const candidate of candidates) {
    try {
      assertAccessible(candidate);
      const canonical = canonicalize(candidate);
      assertRegularFile(canonical);
      if (/^git version \S+/.test(probe(canonical))) return canonical;
    } catch {
      // Continue through the Principal's native PATH and report one clear
      // prerequisite failure if no exact executable can be proved.
    }
  }
  throw new Error(
    "Git prerequisite failed: no runnable absolute Git executable was found on the native PATH",
  );
}
