/**
 * Mission Control plan CLI — agent-friendly subcommands.
 *
 * Sdílí stejné gates jako HTTP API (validate.ts + store.ts + work-board.ts),
 * žádná business logika se neduplikuje. Každý subcommand má `--format json|text`
 * (default text pro lidi, JSON pro agent skripty) a `--help`.
 *
 * Subcommands (kód plánu = prefix z mission-control.config.json, např. DEV-0001):
 *   plan status <kód plánu>  — priority/status/PR snapshot
 *   plan work <kód plánu>    — linked TODO/DONE/ISSUES + broken links
 *   plan check <kód plánu>   — co brání uzavření plánu (pro CI gate)
 *   plan close <kód plánu>   — invariant check + zápis status: done
 *   plan export-todo <kód plánu>  — alias na export-todo.ts (dry-run)
 */

import { stringify as stringifyYaml } from 'yaml';
import { buildTodoExportProposal } from './export-todo.ts';
import type { MissionControlPlan } from './model.ts';
import { PLAN_CODE_PLACEHOLDER } from './paths.ts';
import { getPlanByIdOrDevCode, updatePlanYaml } from './store.ts';
import { buildPlanWork, type PlanWorkSummary } from './work-board.ts';

type Format = 'json' | 'text';

type ParsedArgs = {
	subcommand: string;
	devCode?: string;
	format: Format;
	help: boolean;
	rest: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
	const args = argv.slice(2);
	const subcommand = args[0] ?? 'help';
	const rest: string[] = [];
	let format: Format = 'text';
	let help = false;
	let devCode: string | undefined;
	for (let i = 1; i < args.length; i++) {
		const value = args[i];
		if (value === '--help' || value === '-h') {
			help = true;
			continue;
		}
		if (value === '--format' || value === '-f') {
			const next = args[++i];
			if (next === 'json' || next === 'text') format = next;
			continue;
		}
		if (value.startsWith('--format=')) {
			const next = value.slice('--format='.length);
			if (next === 'json' || next === 'text') format = next;
			continue;
		}
		if (value.startsWith('--')) {
			rest.push(value);
			continue;
		}
		if (!devCode) {
			devCode = value;
		} else {
			rest.push(value);
		}
	}
	return { subcommand, devCode, format, help, rest };
}

function printHelp() {
	console.log(`Mission Control plan CLI

  bun run plan status ${PLAN_CODE_PLACEHOLDER}     — priority/status/PR snapshot
  bun run plan work ${PLAN_CODE_PLACEHOLDER}       — linked TODO/DONE/ISSUES + broken links
  bun run plan check ${PLAN_CODE_PLACEHOLDER}      — co brání uzavření plánu (open TODO, ISSUES, …)
  bun run plan close ${PLAN_CODE_PLACEHOLDER}      — invariant check + status: done
  bun run plan export-todo ${PLAN_CODE_PLACEHOLDER} — dry-run TODO export

Flags:
  --format json|text   default text; JSON je strojově čitelné pro agent skripty
  --help, -h           tato nápověda
`);
}

function fail(message: string, exitCode = 1): never {
	console.error(`Error: ${message}`);
	process.exit(exitCode);
}

function emit(payload: unknown, format: Format, textRender: () => string) {
	if (format === 'json') {
		console.log(JSON.stringify(payload, null, 2));
	} else {
		console.log(textRender());
	}
}

function planSnapshot(plan: MissionControlPlan) {
	return {
		dev_code: plan.dev_code,
		id: plan.id,
		title: plan.title,
		status: plan.status,
		priority: plan.priority,
		priority_rank: plan.priority_rank,
		owner: plan.owner,
		updated_at: plan.updated_at,
		github: plan.github ?? { branches: [], prs: [] },
	};
}

function renderStatusText(snapshot: ReturnType<typeof planSnapshot>): string {
	const lines: string[] = [];
	lines.push(`${snapshot.dev_code} · ${snapshot.title}`);
	lines.push(`  status: ${snapshot.status}`);
	lines.push(`  priority: ${snapshot.priority} (rank ${snapshot.priority_rank})`);
	lines.push(`  owner: ${snapshot.owner}`);
	lines.push(`  updated_at: ${snapshot.updated_at}`);
	const branches = snapshot.github?.branches ?? [];
	if (branches.length > 0) {
		lines.push(`  branches: ${branches.join(', ')}`);
	}
	const prs = snapshot.github?.prs ?? [];
	for (const pr of prs) {
		lines.push(`  pr: ${pr.url} (${pr.status ?? 'no status'})`);
	}
	return lines.join('\n');
}

function renderWorkText(work: PlanWorkSummary): string {
	const lines: string[] = [];
	lines.push(`${work.plan.dev_code} · ${work.plan.title}`);
	lines.push(`  Open TODO: ${work.todo_open.length}`);
	lines.push(`  DONE evidence: ${work.done.length}`);
	lines.push(`  Open ISSUES: ${work.issues_open.length}`);
	lines.push(`  Broken planning links: ${work.broken_links.length}`);
	if (work.close_blockers.length > 0) {
		lines.push('');
		lines.push('Close blockery:');
		for (const blocker of work.close_blockers) {
			lines.push(`  - ${blocker}`);
		}
	} else {
		lines.push('');
		lines.push('Žádné close blockery — plán by `plan close` přijal.');
	}
	if (work.todo_open.length > 0) {
		lines.push('');
		lines.push('Open TODO:');
		for (const item of work.todo_open) {
			lines.push(`  - ${item.id} · ${item.title} [${item.status}] ${item.ledger_path}`);
		}
	}
	if (work.issues_open.length > 0) {
		lines.push('');
		lines.push('Open ISSUES:');
		for (const item of work.issues_open) {
			lines.push(`  - ${item.id} · ${item.title} [${item.status}] ${item.ledger_path}`);
		}
	}
	if (work.broken_links.length > 0) {
		lines.push('');
		lines.push('Rozbité planning vazby:');
		for (const item of work.broken_links) {
			const errors = (item.planning_errors ?? []).map((error) => error.code).join(', ');
			lines.push(`  - ${item.id} · ${item.title} [${errors}] ${item.ledger_path}`);
		}
	}
	return lines.join('\n');
}

async function ensurePlan(devCode: string | undefined) {
	if (!devCode)
		fail(
			`Chybí kód plánu ${PLAN_CODE_PLACEHOLDER}. Použij \`bun run plan <subcommand> ${PLAN_CODE_PLACEHOLDER}\`.`,
		);
	const record = await getPlanByIdOrDevCode(devCode as string);
	if (!record) fail(`Plán ${devCode} neexistuje.`);
	return record;
}

async function runStatus(args: ParsedArgs) {
	const record = await ensurePlan(args.devCode);
	const snapshot = planSnapshot(record.plan);
	emit(
		{ plan: snapshot, path: record.workspacePath },
		args.format,
		() => `${renderStatusText(snapshot)}\n  path: ${record.workspacePath}`,
	);
}

async function runWork(args: ParsedArgs) {
	const record = await ensurePlan(args.devCode);
	const work = await buildPlanWork(record);
	emit(work, args.format, () => renderWorkText(work));
}

async function runCheck(args: ParsedArgs) {
	const record = await ensurePlan(args.devCode);
	const work = await buildPlanWork(record);
	const ok = work.close_blockers.length === 0;
	const payload = {
		plan: planSnapshot(record.plan),
		path: record.workspacePath,
		ok,
		blockers: work.close_blockers,
		open_todo: work.todo_open.length,
		open_issues: work.issues_open.length,
		broken_links: work.broken_links.length,
	};
	emit(payload, args.format, () => {
		const head = ok
			? `${record.plan.dev_code} · OK — plán by 'plan close' přijal.`
			: `${record.plan.dev_code} · BLOCKED — ${work.close_blockers.length} blockerů:`;
		const lines = [head];
		for (const blocker of work.close_blockers) {
			lines.push(`  - ${blocker}`);
		}
		return lines.join('\n');
	});
	if (!ok) process.exit(2);
}

async function runClose(args: ParsedArgs) {
	const record = await ensurePlan(args.devCode);
	const work = await buildPlanWork(record);
	if (work.close_blockers.length > 0) {
		emit(
			{
				ok: false,
				dev_code: record.plan.dev_code,
				blockers: work.close_blockers,
				hint: `Použij \`bun run plan check ${PLAN_CODE_PLACEHOLDER}\` pro detailní výpis. Uzavři open TODO/ISSUES, doplň PR metadata a teprve potom \`plan close\`.`,
			},
			args.format,
			() =>
				[
					`${record.plan.dev_code} · plan close ODMÍTNUTO`,
					'',
					...work.close_blockers.map((blocker) => `  - ${blocker}`),
					'',
					'Hint: uzavři open TODO/ISSUES, doplň github.prs[*] a spusť `plan close` znovu.',
				].join('\n'),
		);
		process.exit(2);
	}
	const today = new Date().toISOString().slice(0, 10);
	const next: MissionControlPlan = {
		...record.plan,
		status: 'done',
		updated_at: today,
	};
	const yaml = stringifyYaml(next);
	await updatePlanYaml(record.absolutePath, yaml);
	emit(
		{
			ok: true,
			dev_code: record.plan.dev_code,
			status: 'done',
			updated_at: today,
			path: record.workspacePath,
		},
		args.format,
		() =>
			`${record.plan.dev_code} · plan close PROŠEL\n  status: done\n  updated_at: ${today}\n  path: ${record.workspacePath}`,
	);
}

async function runExportTodo(args: ParsedArgs) {
	const record = await ensurePlan(args.devCode);
	const proposal = await buildTodoExportProposal(record.plan.dev_code);
	emit(proposal, args.format, () => JSON.stringify(proposal, null, 2));
}

async function main() {
	const args = parseArgs(process.argv);
	if (args.help || args.subcommand === 'help' || args.subcommand === '--help') {
		printHelp();
		return;
	}
	try {
		switch (args.subcommand) {
			case 'status':
				await runStatus(args);
				break;
			case 'work':
				await runWork(args);
				break;
			case 'check':
				await runCheck(args);
				break;
			case 'close':
				await runClose(args);
				break;
			case 'export-todo':
				await runExportTodo(args);
				break;
			default:
				fail(`Neznámý subcommand: ${args.subcommand}. Spusť \`bun run plan --help\`.`);
		}
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
}

// Run only when executed directly (allows unit tests to import functions).
if (import.meta.main) {
	void main();
}

// Re-exports for tests.
export {
	parseArgs,
	planSnapshot,
	renderStatusText,
	renderWorkText,
	runCheck,
	runClose,
	runStatus,
	runWork,
};
