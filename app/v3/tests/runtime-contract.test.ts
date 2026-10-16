import { describe, expect, test } from 'bun:test';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Lazurio Module Standard start contract (decision 0171): one server process,
// host and port only from the Launchpad listener environment, the client build
// as declared preparation.

const appRoot = resolve(import.meta.dir, '..');
const appPackage = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8'));
const serverSource = readFileSync(resolve(appRoot, 'src/server.ts'), 'utf8');

// The bundled fixture data roots (set by the test preload), without any
// listener variable.
function baseEnv(): Record<string, string> {
	return {
		PATH: process.env.PATH ?? '',
		// Windows needs its system root to start a process at all.
		...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
		MISSION_CONTROL_ROOT: process.env.MISSION_CONTROL_ROOT ?? '',
		MISSION_CONTROL_WORKSPACE_ROOT: process.env.MISSION_CONTROL_WORKSPACE_ROOT ?? '',
	};
}

function listenerEnv(port: number): Record<string, string> {
	return {
		...baseEnv(),
		LAZURIO_RUNTIME_LISTENER_WEB_HOST: '127.0.0.1',
		LAZURIO_RUNTIME_LISTENER_WEB_PORT: String(port),
	};
}

function freePort(): number {
	const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
	const port = probe.port;
	probe.stop(true);
	if (port === undefined) throw new Error('no free loopback port');
	return port;
}

async function waitForPlans(port: number): Promise<Response> {
	const deadline = Date.now() + 30_000;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			return await fetch(`http://127.0.0.1:${port}/api/plans`);
		} catch (error) {
			lastError = error;
			await Bun.sleep(100);
		}
	}
	throw new Error(`server did not answer on ${port}: ${String(lastError)}`);
}

describe('Mission Control runtime contract', () => {
	test('dev starts one Bun server process and nothing else', () => {
		expect(appPackage.scripts.dev).toBe('bun run src/server.ts');
		expect(appPackage.lazurio.runtime.dev_script).toBe('dev');
		expect(appPackage.devDependencies.concurrently).toBeUndefined();
		expect(appPackage.dependencies.concurrently).toBeUndefined();
		expect(appPackage.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
		expect(appPackage.lazurio.runtime.preview_script).toBeUndefined();
	});

	test('declares the client build as preparation, never as an npm lifecycle script', () => {
		expect(appPackage.lazurio.preparation).toEqual({
			schema_version: 'lazurio.preparation.v1',
			owner_package: 'app/v3/package.json',
			prepare_script: 'prepare:app',
			check_script: 'check:prepared',
		});
		expect(appPackage.scripts['prepare:app']).toBe('bun ./node_modules/vite/bin/vite.js build');
		expect(appPackage.scripts['check:prepared']).toBe('bun run src/prepared.ts');
		for (const lifecycle of ['prepare', 'preinstall', 'install', 'postinstall', 'prepack']) {
			expect(appPackage.scripts[lifecycle]).toBeUndefined();
		}
	});

	test('reads its listener only through module-kit, never from the lease file', () => {
		expect(serverSource).toContain("listener('web')");
		expect(serverSource).not.toContain('lazurio.module.json');
		expect(serverSource).not.toMatch(/process\.env\.(?:PORT|LAZURIO_RUNTIME_(?:HOST|PORT))\b/);
		expect(serverSource).not.toMatch(/process\.env\.LAZURIO_RUNTIME_LISTENER_/);
	});

	test('refuses to start without the Launchpad listener environment', () => {
		const result = Bun.spawnSync([process.execPath, 'run', 'src/server.ts'], {
			cwd: appRoot,
			env: baseEnv(),
		});
		expect(result.exitCode).toBe(2);
		expect(result.stderr.toString()).toContain('LAZURIO_RUNTIME_LISTENER_WEB_HOST');
	});

	test('check:prepared is a read-only check of dist/index.html', async () => {
		const root = mkdtempSync(join(tmpdir(), 'mission-control-prepared-'));
		try {
			mkdirSync(join(root, 'src'));
			copyFileSync(resolve(appRoot, 'src/prepared.ts'), join(root, 'src/prepared.ts'));
			const run = () =>
				Bun.spawnSync([process.execPath, 'run', 'src/prepared.ts'], {
					cwd: root,
					env: { PATH: process.env.PATH ?? '' },
				});
			const missing = run();
			expect(missing.exitCode).toBe(1);
			expect(missing.stderr.toString()).toContain('prepare:app');
			expect(readdirSync(root).sort()).toEqual(['src']);
			mkdirSync(join(root, 'dist'));
			writeFileSync(join(root, 'dist/index.html'), '<!doctype html>');
			expect(run().exitCode).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// Every start-time configuration error has the same exit code 2.
	for (const [label, override] of [
		[
			'an origin module-kit rejects (trailing slash)',
			{ LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN: 'https://pilot.example.lazurio.io/' },
		],
		[
			'an origin only the app rejects (http)',
			{ LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN: 'http://pilot.example.lazurio.io' },
		],
		['a non-loopback host', { LAZURIO_RUNTIME_LISTENER_WEB_HOST: '0.0.0.0' }],
	] as const) {
		test(`exits 2 on ${label}`, () => {
			const result = Bun.spawnSync([process.execPath, 'run', 'src/server.ts'], {
				cwd: appRoot,
				env: { ...listenerEnv(freePort()), ...override },
			});
			expect(result.exitCode).toBe(2);
			expect(result.stderr.toString()).toContain('[mission-control]');
		});
	}

	test('serves the API on exactly the injected listener', async () => {
		const port = freePort();
		const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
			cwd: appRoot,
			env: listenerEnv(port),
			stdout: 'pipe',
			stderr: 'pipe',
		});
		try {
			const response = await waitForPlans(port);
			expect(response.status).toBe(200);
			expect(Array.isArray(((await response.json()) as { records?: unknown }).records)).toBe(true);
		} finally {
			server.kill();
			await server.exited;
		}
	});

	// Windows has no SIGTERM; the platform terminates the process instead.
	test.skipIf(process.platform === 'win32')('exits 0 on SIGTERM', async () => {
		const port = freePort();
		const server = Bun.spawn([process.execPath, 'run', 'src/server.ts'], {
			cwd: appRoot,
			env: listenerEnv(port),
			stdout: 'pipe',
			stderr: 'pipe',
		});
		await waitForPlans(port);
		server.kill('SIGTERM');
		expect(await server.exited).toBe(0);
	});
});
