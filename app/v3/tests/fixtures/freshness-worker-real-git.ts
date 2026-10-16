import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMissionControlTestSshExecutable } from '../../../../src/mission-control-publish-flow.mjs';
// The production Worker module owns `onmessage` and runs the real bounded
// freshness engine (real Git fetch through the SSH transport boundary).
import '../../src/repository-freshness-worker.ts';

// Test-only: a Bun Worker has its own module instance, so the process-scoped
// test SSH trust installed by test-support in the main thread is invisible
// here. Re-install exactly the same process-specific fixture path so the real
// fetch can reach the loopback fixture remote. Nothing else is stubbed.
installMissionControlTestSshExecutable(
	join(tmpdir(), `mission-control-test-ssh-${process.pid}`, 'ssh'),
);
