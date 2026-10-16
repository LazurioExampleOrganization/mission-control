import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Symlink creation is a privilege on Windows (Developer Mode or
// SeCreateSymbolicLinkPrivilege), not a filesystem given. Tests that build
// symlink fixtures must probe first so a missing capability becomes an
// explicit platform skip instead of an EPERM fixture failure that looks like
// a product regression. Any other probe error is still a real failure.
export function detectSymlinkSupport() {
  const probeRoot = join(
    tmpdir(),
    `mission-control-symlink-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    mkdirSync(probeRoot, { recursive: true });
    writeFileSync(join(probeRoot, "target"), "probe\n");
    symlinkSync(join(probeRoot, "target"), join(probeRoot, "link"));
    return true;
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") return false;
    throw error;
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}
