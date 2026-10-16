import { describe, expect, test } from 'bun:test';
import { buildRoadmapsResponse } from '../src/roadmaps.ts';
import { createLocalHttpSecurityContext, parseExternalOrigin, route } from '../src/server.ts';

type ValidationReport = { ok: boolean; errors: Array<{ path: string; message: string }> };

describe('Mission Control v3 server API', () => {
	const security = createLocalHttpSecurityContext({
		host: '127.0.0.1',
		port: 5501,
		sessionToken: 'test-session-token',
	});

	function authorizedJsonRequest(path: string, body: unknown): Request {
		return new Request(`http://127.0.0.1:5501${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'http://127.0.0.1:5501',
				'x-mission-control-session': 'test-session-token',
			},
			body: JSON.stringify(body),
		});
	}

	test('rejects DNS-rebinding Host before serving a local session', async () => {
		const response = await route(new Request('http://attacker.invalid/api/session'), security);
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ error: 'forbidden_host' });
	});

	test('requires exact Origin and process-local session token for writes', async () => {
		const missingToken = await route(
			new Request('http://127.0.0.1:5501/api/issues/resolve', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					origin: 'http://127.0.0.1:5501',
				},
				body: '{}',
			}),
			security,
		);
		expect(missingToken.status).toBe(403);
		expect(await missingToken.json()).toMatchObject({
			error: 'invalid_local_session',
		});

		const foreignOrigin = await route(
			new Request('http://127.0.0.1:5501/api/issues/resolve', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					origin: 'http://evil.invalid',
					'x-mission-control-session': 'test-session-token',
				},
				body: '{}',
			}),
			security,
		);
		expect(foreignOrigin.status).toBe(403);
		expect(await foreignOrigin.json()).toMatchObject({
			error: 'forbidden_origin',
		});

		const unguardedDelete = await route(
			new Request('http://127.0.0.1:5501/api/repository/changesets/local-draft', {
				method: 'DELETE',
				headers: {
					'content-type': 'application/json',
					origin: 'http://127.0.0.1:5501',
				},
				body: '{}',
			}),
			security,
		);
		expect(unguardedDelete.status).toBe(403);
		expect(await unguardedDelete.json()).toMatchObject({
			error: 'invalid_local_session',
		});
	});

	test('issues a session only on the fixed Host allowlist', async () => {
		const response = await route(new Request('http://127.0.0.1:5501/api/session'), security);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ token: 'test-session-token' });
	});

	test('legacy issue endpoint is retired even with a valid writer session', async () => {
		const response = await route(authorizedJsonRequest('/api/issues/resolve', {}), security);
		expect(response.status).toBe(410);
		expect(await response.json()).toMatchObject({
			error: 'legacy_issues_read_only',
		});
	});

	describe('hosted external origin (decision 0146)', () => {
		const hostedOrigin = 'https://mission-control.pilot.example.lazurio.io';
		const hostedSecurity = createLocalHttpSecurityContext({
			host: '127.0.0.1',
			port: 5501,
			externalOrigin: hostedOrigin,
			sessionToken: 'test-session-token',
		});

		function hostedRequest(path: string, init: RequestInit = {}): Request {
			// The gateway forwards the original Host to the loopback listener.
			return new Request(`http://127.0.0.1:5501${path}`, {
				...init,
				headers: {
					host: 'mission-control.pilot.example.lazurio.io',
					...(init.headers as Record<string, string> | undefined),
				},
			});
		}

		test('admits the hosted Host and Origin when the external origin is configured', async () => {
			const session = await route(hostedRequest('/api/session'), hostedSecurity);
			expect(session.status).toBe(200);
			expect(await session.json()).toEqual({ token: 'test-session-token' });

			const write = await route(
				hostedRequest('/api/issues/resolve', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						origin: hostedOrigin,
						'x-mission-control-session': 'test-session-token',
					},
					body: '{}',
				}),
				hostedSecurity,
			);
			// Past the Host/Origin/session guards; the retired route itself answers 410.
			expect(write.status).toBe(410);
			expect(await write.json()).toMatchObject({ error: 'legacy_issues_read_only' });
		});

		test('keeps rejecting the hosted Host without the external origin', async () => {
			const response = await route(hostedRequest('/api/session'), security);
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ error: 'forbidden_host' });
		});

		test('keeps loopback Host and Origin working with the external origin configured', async () => {
			const session = await route(new Request('http://127.0.0.1:5501/api/session'), hostedSecurity);
			expect(session.status).toBe(200);
			const write = await route(authorizedJsonRequest('/api/issues/resolve', {}), hostedSecurity);
			expect(write.status).toBe(410);
		});

		test('rejects a foreign Host and a mismatched Origin under the hosted context', async () => {
			const foreignHost = await route(
				new Request('http://127.0.0.1:5501/api/session', {
					headers: { host: 'mission-control.other.example.lazurio.io' },
				}),
				hostedSecurity,
			);
			expect(foreignHost.status).toBe(403);
			expect(await foreignHost.json()).toMatchObject({ error: 'forbidden_host' });

			const httpOrigin = await route(
				hostedRequest('/api/issues/resolve', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						origin: 'http://mission-control.pilot.example.lazurio.io',
						'x-mission-control-session': 'test-session-token',
					},
					body: '{}',
				}),
				hostedSecurity,
			);
			expect(httpOrigin.status).toBe(403);
			expect(await httpOrigin.json()).toMatchObject({ error: 'forbidden_origin' });
		});

		test('fails closed on an invalid external origin at context creation', () => {
			for (const invalid of [
				'',
				'not a url',
				'http://mission-control.pilot.example.lazurio.io',
				'https://mission-control.pilot.example.lazurio.io/',
				'https://mission-control.pilot.example.lazurio.io/app',
				'https://mission-control.pilot.example.lazurio.io?x=1',
				'https://mission-control.pilot.example.lazurio.io#top',
				'https://user:pw@mission-control.pilot.example.lazurio.io',
				'https://Mission-Control.pilot.example.lazurio.io',
				'https://10.0.0.1',
				'https://[::1]',
				'https://localhost',
				'https://mission-control.localhost',
				'https://mission-control.pilot.localhost',
				'https://mission-control.pilot.example.lazurio.io:8443',
				'https://mission-control.pilot.example.lazurio.io:443',
				' https://mission-control.pilot.example.lazurio.io',
			]) {
				expect(() =>
					createLocalHttpSecurityContext({
						host: '127.0.0.1',
						port: 5501,
						externalOrigin: invalid,
						sessionToken: 'test-session-token',
					}),
				).toThrow(/LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN/);
			}
			expect(parseExternalOrigin(hostedOrigin)).toEqual({
				host: 'mission-control.pilot.example.lazurio.io',
				origin: hostedOrigin,
			});
		});
	});

	test('fails closed for API mutations without a local security context', async () => {
		const response = await route(
			new Request('http://127.0.0.1/api/repository/pull', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			}),
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			error: 'local_security_context_required',
		});
	});

	test('serves MCv3 Roadmaps with next runnable step', async () => {
		const response = await route(new Request('http://127.0.0.1/api/roadmaps'));
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			roadmaps: any[];
			validation: { ok: boolean; failures: string[] };
		};
		expect(payload.validation.ok).toBe(true);
		expect(payload.roadmaps.length).toBeGreaterThan(0);
		const roadmapRecord =
			payload.roadmaps.find((record) => record.next_step) ?? payload.roadmaps[0];
		expect(roadmapRecord.roadmap.roadmap_code).toMatch(/^RM-[0-9]{4}$/);
		expect(['planned', 'in_progress', 'blocked', 'done', 'archived']).toContain(
			roadmapRecord.roadmap.status,
		);
		expect(['main', 'worktree', 'branch', 'detached', 'unknown']).toContain(
			roadmapRecord.runtime_lane.source,
		);
		expect(roadmapRecord.work_summary.ledger_read_errors).toEqual([]);
		expect(
			roadmapRecord.work_summary.linked_items.map((item: { id: string }) => item.id),
		).toContain('task-2026-01-01-001');
		expect(roadmapRecord.release_gate.checks.map((check: { id: string }) => check.id)).toEqual(
			expect.arrayContaining([
				'validation',
				'roadmap-steps',
				'linked-work',
				'runtime-lane',
				'agent-lane',
			]),
		);
	});

	test('blocks Roadmap release gate when global Mission Control validation is red', () => {
		const payload = buildRoadmapsResponse({
			additionalValidationFailures: [
				'data/mission-control/plans/2026/01/DEV-9999-example.yaml: injected failure',
			],
		});
		const roadmapRecord = payload.roadmaps[0];
		expect(payload.validation.ok).toBe(false);
		expect(roadmapRecord?.validation.ok).toBe(true);
		expect(roadmapRecord?.release_gate.status).toBe('blocked');
		expect(
			roadmapRecord?.release_gate.checks.find((check) => check.id === 'validation')?.status,
		).toBe('blocker');
	});

	test('drafts new roadmap YAML from a source plan without writing source', async () => {
		const response = await route(
			authorizedJsonRequest('/api/roadmaps/draft', {
				source_plan: 'DEV-0001',
				title: 'Roadmap API smoke',
				owner: 'template-steward',
			}),
			security,
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			write_applied: boolean;
			roadmap_code: string;
			path: string;
			workspacePath: string;
			yaml: string;
			validation: ValidationReport;
		};
		expect(payload.write_applied).toBe(false);
		expect(payload.roadmap_code).toBe('RM-0002');
		expect(payload.path).toBe('data/mission-control/roadmaps/2026/RM-0002-roadmap-api-smoke.yaml');
		expect(payload.workspacePath).toContain('RM-0002-roadmap-api-smoke.yaml');
		expect(payload.yaml).toContain('source_plan: DEV-0001');
		expect(payload.validation.ok).toBe(true);
	});

	test('drafts Roadmap Step edits as diff preview without writing source', async () => {
		const roadmapsPayload = buildRoadmapsResponse();
		const roadmapRecord =
			roadmapsPayload.roadmaps.find((record) => record.next_step) ?? roadmapsPayload.roadmaps[0];
		const roadmapCode = roadmapRecord.roadmap.roadmap_code;
		const step =
			roadmapRecord.next_step ??
			roadmapRecord.roadmap.steps.find((item: { id?: string }) => item.id);
		expect(step?.id).toBeTruthy();
		const planRefs = step.plan_refs?.length
			? step.plan_refs
			: [roadmapRecord.roadmap.source_plan].filter(Boolean);
		const response = await route(
			authorizedJsonRequest(`/api/roadmaps/${roadmapCode}/steps/draft`, {
				dry_run: true,
				mode: 'update',
				step_id: step.id,
				plan_refs: planRefs,
				acceptance_criteria: ['Diff preview validates before any source-of-truth write.'],
			}),
			security,
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			write_applied: boolean;
			step: { id: string; plan_refs: string[]; acceptance_criteria: string[] };
			yaml: string;
			diff: string;
			validation: ValidationReport;
		};
		expect(payload.write_applied).toBe(false);
		expect(payload.step.id).toBe(step.id);
		expect(payload.diff).toContain('Diff preview validates before any source-of-truth write.');
		expect(payload.validation.ok).toBe(true);
	});

	test('requires explicit dry_run for Roadmap Step draft proposals', async () => {
		const roadmapsPayload = buildRoadmapsResponse();
		const roadmapRecord =
			roadmapsPayload.roadmaps.find((record) => record.next_step) ?? roadmapsPayload.roadmaps[0];
		const step =
			roadmapRecord.next_step ??
			roadmapRecord.roadmap.steps.find((item: { id?: string }) => item.id);
		const response = await route(
			authorizedJsonRequest(`/api/roadmaps/${roadmapRecord.roadmap.roadmap_code}/steps/draft`, {
				mode: 'update',
				step_id: step.id,
			}),
			security,
		);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toBe('dry_run_required');
	});
});
