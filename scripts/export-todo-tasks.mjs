#!/usr/bin/env bun
// Mission Control → TODO.tasks.json export.
// Default mode is dry-run: prints proposed tasks as JSON and exits.
// `--apply` mode appends tasks to the target TODO.tasks.json. Without an
// explicit `--apply`, the script never writes.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { buildExportProposal } from "../app/v1/src/export.ts";
import {
	getPlanById,
	readPlanRecord,
	WORKSPACE_ROOT,
} from "../app/v1/src/plans.ts";

function parseArgs(argv) {
	const flags = {
		plan: null,
		file: null,
		target: null,
		apply: false,
		help: false,
		quiet: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const value = argv[i];
		switch (value) {
			case "--plan":
				flags.plan = argv[++i] ?? null;
				break;
			case "--file":
				flags.file = argv[++i] ?? null;
				break;
			case "--target":
				flags.target = argv[++i] ?? null;
				break;
			case "--apply":
				flags.apply = true;
				break;
			case "--quiet":
				flags.quiet = true;
				break;
			case "--help":
			case "-h":
				flags.help = true;
				break;
			default:
				if (!value.startsWith("--") && !flags.plan && !flags.file) {
					flags.plan = value;
				}
		}
	}
	return flags;
}

function printHelp() {
	process.stdout.write(`Mission Control → TODO.tasks.json export

Použití:
  bun run scripts/export-todo-tasks.mjs --plan <plan-id> [--apply]
  bun run scripts/export-todo-tasks.mjs --file mission-control/plans/2026/05/<slug>.yaml

Volby:
  --plan <id>        Plan ID (např. plan-2026-05-23-001)
  --file <path>      Plan YAML relativní ke workspace rootu nebo absolutní cesta
  --target <path>    TODO.tasks.json target; defaultně z plan.planning_target.todo_tasks_path
  --apply            Zápis do target TODO.tasks.json (bez --apply je default dry-run)
  --quiet            Tiší výpis (vhodné pro pipe do dalšího nástroje)
  --help             Tato nápověda

Bez --apply je vždy dry-run. Materializace zapíše tasky se source: mission-control,
planning.plan_id a planning.path zpět na Mission Control plán.
`);
}

async function loadPlan(flags) {
	if (flags.plan) {
		const record = await getPlanById(flags.plan);
		if (!record) throw new Error(`Plán s ID ${flags.plan} nebyl nalezen.`);
		return record;
	}
	if (flags.file) {
		const absolutePath = path.isAbsolute(flags.file)
			? flags.file
			: path.resolve(WORKSPACE_ROOT, flags.file);
		if (!existsSync(absolutePath)) {
			throw new Error(`Plan soubor neexistuje: ${absolutePath}`);
		}
		return await readPlanRecord(absolutePath);
	}
	throw new Error("Musíš zadat --plan <id> nebo --file <path>.");
}

function resolveTargetPath(plan, flags) {
	if (flags.target) {
		return path.isAbsolute(flags.target)
			? flags.target
			: path.resolve(WORKSPACE_ROOT, flags.target);
	}
	const target = plan.planning_target;
	if (target?.todo_tasks_path) {
		return path.resolve(WORKSPACE_ROOT, target.todo_tasks_path);
	}
	return null;
}

async function loadTargetFile(targetPath) {
	if (!existsSync(targetPath)) {
		throw new Error(
			`Target TODO.tasks.json neexistuje: ${targetPath}. Vytvoř ho ručně nebo zvol jiný target.`,
		);
	}
	const raw = await readFile(targetPath, "utf8");
	const data = JSON.parse(raw);
	if (data.schema_version !== "companiesascode.todo_tasks.v1") {
		throw new Error(
			`Target soubor nemá očekávaný schema_version companiesascode.todo_tasks.v1.`,
		);
	}
	if (!Array.isArray(data.tasks)) {
		throw new Error(`Target soubor nemá pole tasks.`);
	}
	return { data, raw };
}

async function applyExport(targetPath, proposed) {
	const { data } = await loadTargetFile(targetPath);
	const existingIds = new Set(data.tasks.map((task) => task.id));
	const fresh = proposed.filter((task) => !existingIds.has(task.id));
	if (fresh.length === 0) {
		return { written: false, added: 0, total: data.tasks.length };
	}
	const next = { ...data, tasks: [...data.tasks, ...fresh] };
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return { written: true, added: fresh.length, total: next.tasks.length };
}

async function main() {
	const flags = parseArgs(process.argv.slice(2));
	if (flags.help) {
		printHelp();
		return;
	}
	if (!flags.plan && !flags.file) {
		printHelp();
		process.exit(1);
	}

	const record = await loadPlan(flags);
	if (!record.validation.ok) {
		const errors = record.validation.errors
			.map((err) => `  - ${err.path}: ${err.message}`)
			.join("\n");
		throw new Error(
			`Plán ${record.plan.id} (${record.relativePath}) neprošel validací:\n${errors}`,
		);
	}

	const proposal = await buildExportProposal(record);
	const targetPath = resolveTargetPath(record.plan, flags);

	if (!flags.apply) {
		const output = {
			mode: "dry-run",
			plan: {
				id: proposal.plan_id,
				path: proposal.plan_path,
			},
			target: targetPath
				? {
						scope: record.plan.planning_target?.scope ?? null,
						todo_tasks_path: path.relative(WORKSPACE_ROOT, targetPath),
					}
				: null,
			warnings: proposal.warnings,
			proposed_tasks: proposal.proposed_tasks,
		};
		if (!flags.quiet) {
			console.error(
				`Dry-run: ${proposal.proposed_tasks.length} task(ů) z plánu ${proposal.plan_id}.`,
			);
			for (const warning of proposal.warnings) {
				console.error(`! ${warning}`);
			}
			if (!targetPath) {
				console.error(
					"! Plán nemá planning_target.todo_tasks_path; uveď --target před --apply.",
				);
			}
		}
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	if (!targetPath) {
		throw new Error(
			"--apply potřebuje target TODO.tasks.json: doplň ho přes plan.planning_target.todo_tasks_path nebo --target.",
		);
	}

	const result = await applyExport(targetPath, proposal.proposed_tasks);
	if (!flags.quiet) {
		if (result.written) {
			console.log(
				`✓ ${path.relative(WORKSPACE_ROOT, targetPath)}: +${result.added} task(ů) (celkem ${result.total}).`,
			);
		} else {
			console.log(
				`= ${path.relative(WORKSPACE_ROOT, targetPath)} už obsahuje navržené ID, nic se nezapsalo.`,
			);
		}
		for (const warning of proposal.warnings) {
			console.warn(`! ${warning}`);
		}
	}
	process.stdout.write(
		`${JSON.stringify({ mode: "apply", ...result, target: path.relative(WORKSPACE_ROOT, targetPath) }, null, 2)}\n`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
