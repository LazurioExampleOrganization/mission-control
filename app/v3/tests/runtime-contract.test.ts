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
import { clientDirectory } from '../src/server.ts';

// Lazurio Module Standard start contract (decision 0171): one server process,
// host and port only from the Launchpad listener environment, the client build
// as declared preparation. From `main` the same server is the production start
// (`start_script`, LazurioPlatform F58 addendum (2), root decision 0195 point
// 24), handed its client's stored build as LAZURIO_RUNTIME_BUILD_OUTPUT.

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

async function waitForServer(port: number, path = '/api/plans'): Promise<Response> {
	const deadline = Date.now() + 30_000;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			return await fetch(`http://127.0.0.1:${port}${path}`);
		} catch (error) {
			lastError = error;
			await Bun.sleep(100);
		}
	}
	throw new Error(`server did not answer on ${port}: ${String(lastError)}`);
}

describe('Mission Control runtime contract', () => {
	test('dev starts one Bun server process and nothing else', () => {
		expect(appPackage.scripts.dev).toBe('bun --no-env-file run src/server.ts');
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

	test('starts from main as its own one-process server with the client as its build', () => {
		const runtime = appPackage.lazurio.runtime;
		// The development server already is the production server: one Bun
		// process that serves a prebuilt client, nothing development-only.
		expect(runtime.start_script).toBe('dev');
		expect(appPackage.scripts[runtime.start_script]).toBe('bun --no-env-file run src/server.ts');
		// The build is the client only; the server runs from the checkout.
		expect(runtime.build_script).toBe('prepare:app');
		expect(runtime.build_output).toBe('dist');
		expect(runtime.static_fallback).toBeUndefined();
	});

	test('serves its client from LAZURIO_RUNTIME_BUILD_OUTPUT when set, else from ./dist', () => {
		const output = resolve(tmpdir(), 'mission-control-build-output');
		expect(clientDirectory({ LAZURIO_RUNTIME_BUILD_OUTPUT: output })).toBe(output);
		expect(clientDirectory({})).toBe(resolve(appRoot, 'dist'));
		expect(clientDirectory({ LAZURIO_RUNTIME_BUILD_OUTPUT: '' })).toBe(resolve(appRoot, 'dist'));
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
			const response = await waitForServer(port);
			expect(response.status).toBe(200);
			expect(Array.isArray(((await response.json()) as { records?: unknown }).records)).toBe(true);
		} finally {
			server.kill();
			await server.exited;
		}
	});

	test('a production start serves the handed build output and the API', async () => {
		const output = mkdtempSync(join(tmpdir(), 'mission-control-build-output-'));
		writeFileSync(join(output, 'index.html'), '<!doctype html><title>fixture build output</title>');
		// The declared start script's command, as the Platform starts it from
		// `main`: in production mode with the stored client output.
		const [bun, ...args] = appPackage.scripts[appPackage.lazurio.runtime.start_script].split(' ');
		expect(bun).toBe('bun');
		const port = freePort();
		const server = Bun.spawn([process.execPath, ...args], {
			cwd: appRoot,
			env: { ...listenerEnv(port), NODE_ENV: 'production', LAZURIO_RUNTIME_BUILD_OUTPUT: output },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		try {
			const health = await waitForServer(port, appPackage.lazurio.runtime.listeners[0].health.path);
			expect(health.status).toBe(200);
			expect(await health.text()).toContain('fixture build output');
			const plans = await fetch(`http://127.0.0.1:${port}/api/plans`);
			expect(plans.status).toBe(200);
			expect(Array.isArray(((await plans.json()) as { records?: unknown }).records)).toBe(true);
		} finally {
			server.kill();
			await server.exited;
			rmSync(output, { recursive: true, force: true });
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
		await waitForServer(port);
		server.kill('SIGTERM');
		expect(await server.exited).toBe(0);
	});
});
