import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { loadMissionControlConfig, loadPlans, type RootPlanRecord } from './mission-control-lib.ts';

export type ProposalLink = { label: string; path?: string; url?: string };

export type ProposalMetadata = {
	schema_version: string;
	id: string;
	slug: string;
	title: string;
	status: string;
	owner: string;
	created_at: string;
	updated_at: string;
	summary: string;
	wireframe: string;
	dev_code?: string | null;
	design_notes?: string;
	links?: ProposalLink[];
};

export type ProposalRecord = {
	folder: string;
	folderPath: string;
	path: string;
	proposal: ProposalMetadata | null;
	parseError: string | null;
};

/** Parsed JSON content of proposal and plan files; deliberately untyped. */
type ParsedData = any;

/** Proposal record whose metadata is validated field by field, so it stays untyped here. */
type ParsedProposalRecord = Omit<ProposalRecord, 'proposal'> & { proposal: ParsedData };

const PROPOSAL_SCHEMA_VERSION = 'companiesascode.mission_control.proposal.v1';
const PROPOSAL_SCHEMA_PATH = 'mission-control/schemas/proposal.schema.json';
export const PROPOSALS_DIR = 'mission-control/proposals';
export const PROPOSAL_STATUSES = [
	'draft',
	'discussion',
	'accepted',
	'implemented',
	'rejected',
	'archived',
];
const STATUSES_REQUIRING_PLAN = ['accepted', 'implemented'];
const ID_PATTERN = /^prop-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEV_CODE_PATTERN = /^[A-Z]{2,6}-[0-9]{4}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const EXTERNAL_TAG_PATTERN =
	/<(script|link|img|iframe|video|audio|source|embed|object|input|base)\b[^>]*\b(src|href|data|srcset)\s*=\s*["']?\s*(https?:)?\/\//i;
const EXTERNAL_CSS_JS_PATTERN =
	/(url\(\s*["']?|@import\s+["']|\b(fetch|import)\s*\(\s*["']|import\s+[^"'\n]*["']|from\s+["'])\s*(https?:)?\/\//i;
const EXTERNAL_SRCSET_PATTERN = /srcset\s*=\s*["'][^"']*?[,\s]\s*(https?:)?\/\//i;

export function loadProposalSchema(root: string): ParsedData {
	return JSON.parse(readFileSync(join(root, PROPOSAL_SCHEMA_PATH), 'utf8'));
}

export function loadProposals(root: string): ProposalRecord[] {
	const proposalsDir = join(root, PROPOSALS_DIR);
	if (!existsSync(proposalsDir)) {
		return [];
	}
	const records: ProposalRecord[] = [];
	for (const entry of readdirSync(proposalsDir).sort()) {
		const entryPath = join(proposalsDir, entry);
		if (!safeLstat(entryPath)?.isDirectory()) {
			continue;
		}
		const relPath = `${PROPOSALS_DIR}/${entry}/proposal.json`;
		const metadataPath = join(entryPath, 'proposal.json');
		let proposal = null;
		let parseError = null;
		if (!existsSync(metadataPath)) {
			parseError = 'chybí proposal.json';
		} else {
			try {
				proposal = JSON.parse(readFileSync(metadataPath, 'utf8'));
			} catch (error) {
				parseError = `JSON parse selhal: ${(error as Error).message}`;
			}
		}
		records.push({ folder: entry, folderPath: entryPath, path: relPath, proposal, parseError });
	}
	return records;
}

function safeLstat(path: string) {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

function pushIf(failures: string[], path: string, condition: unknown, message: string): void {
	if (condition) {
		failures.push(`${path}: ${message}`);
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isValidDate(value: unknown): boolean {
	if (!isNonEmptyString(value) || !DATE_PATTERN.test(value)) {
		return false;
	}
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

function isSafeRelativePath(value: unknown): boolean {
	return isNonEmptyString(value) && !value.startsWith('/') && !value.split('/').includes('..');
}

function resolveRegularFileInside(folderPath: string, relativeFile: string): string | null {
	try {
		const realFolder = realpathSync(folderPath);
		const realFile = realpathSync(join(folderPath, relativeFile));
		if (!realFile.startsWith(realFolder + sep)) {
			return null;
		}
		return lstatSync(realFile).isFile() ? realFile : null;
	} catch {
		return null;
	}
}

function loadPlanIndex(root: string): {
	plansByDevCode: Map<string, RootPlanRecord>;
	loadError: string | null;
} {
	const mountedRepositoryDbRoot = join(root, 'mission-control', 'db');
	const hasMountedRepositoryDb =
		existsSync(join(mountedRepositoryDbRoot, 'repository-db.yaml')) &&
		existsSync(
			join(mountedRepositoryDbRoot, 'data', 'mission-control', 'mission-control.config.json'),
		);
	if (hasMountedRepositoryDb) {
		try {
			const config = loadMissionControlConfig(mountedRepositoryDbRoot);
			const plansByDevCode = new Map<string, RootPlanRecord>();
			for (const record of loadPlans(mountedRepositoryDbRoot, config)) {
				if (record.plan && isNonEmptyString(record.plan.dev_code)) {
					plansByDevCode.set(record.plan.dev_code, record);
				}
			}
			return { plansByDevCode, loadError: null };
		} catch (error) {
			return { plansByDevCode: new Map(), loadError: (error as Error).message };
		}
	}

	try {
		const config = loadMissionControlConfig(root);
		const plansByDevCode = new Map<string, RootPlanRecord>();
		for (const record of loadPlans(root, config)) {
			if (record.plan && isNonEmptyString(record.plan.dev_code)) {
				plansByDevCode.set(record.plan.dev_code, record);
			}
		}
		return { plansByDevCode, loadError: null };
	} catch (error) {
		return { plansByDevCode: new Map(), loadError: (error as Error).message };
	}
}

function validateLinks(failures: string[], path: string, links: unknown, root: string): void {
	if (links === undefined) {
		return;
	}
	if (!Array.isArray(links)) {
		failures.push(`${path}: links musí být pole`);
		return;
	}
	links.forEach((link, index) => {
		const label = `links[${index}]`;
		if (typeof link !== 'object' || link === null || Array.isArray(link)) {
			failures.push(`${path}: ${label} musí být objekt`);
			return;
		}
		const extraKeys = Object.keys(link).filter((key) => !['label', 'path', 'url'].includes(key));
		pushIf(
			failures,
			path,
			extraKeys.length > 0,
			`${label} obsahuje neznámá pole: ${extraKeys.join(', ')}`,
		);
		pushIf(failures, path, !isNonEmptyString(link.label), `${label} musí mít label`);
		pushIf(
			failures,
			path,
			!isNonEmptyString(link.path) && !isNonEmptyString(link.url),
			`${label} musí mít path nebo url`,
		);
		if (isNonEmptyString(link.path)) {
			pushIf(
				failures,
				path,
				!existsSync(join(root, link.path)),
				`${label} path neexistuje: ${link.path}`,
			);
		}
	});
}

export function validateProposalRecords(records: ProposalRecord[], root: string): string[] {
	const failures: string[] = [];
	const schema = loadProposalSchema(root);
	const allowedKeys = Object.keys(schema.properties ?? {});
	const requiredKeys = schema.required ?? [];
	const { plansByDevCode, loadError } = loadPlanIndex(root);
	pushIf(
		failures,
		PROPOSALS_DIR,
		loadError !== null,
		`nelze načíst Mission Control plány pro kontrolu dev_code: ${loadError}`,
	);
	const seenIds = new Map();

	const proposalsDir = join(root, PROPOSALS_DIR);
	if (existsSync(proposalsDir)) {
		for (const entry of readdirSync(proposalsDir)) {
			if (entry.startsWith('.')) {
				continue;
			}
			const stats = safeLstat(join(proposalsDir, entry));
			const isAllowed =
				stats !== null && (stats.isDirectory() || (stats.isFile() && entry === 'README.md'));
			pushIf(
				failures,
				`${PROPOSALS_DIR}/${entry}`,
				!isAllowed,
				'v kořeni proposals patří jen README.md a složky proposalů',
			);
		}
	}

	for (const record of records as ParsedProposalRecord[]) {
		const { path, folder, folderPath, proposal, parseError } = record;
		if (parseError) {
			failures.push(`${path}: ${parseError}`);
			continue;
		}
		if (typeof proposal !== 'object' || proposal === null || Array.isArray(proposal)) {
			failures.push(`${path}: proposal.json musí být objekt`);
			continue;
		}

		const extraKeys = Object.keys(proposal).filter((key) => !allowedKeys.includes(key));
		pushIf(failures, path, extraKeys.length > 0, `obsahuje neznámá pole: ${extraKeys.join(', ')}`);
		for (const key of requiredKeys) {
			pushIf(failures, path, proposal[key] === undefined, `chybí povinné pole ${key}`);
		}

		pushIf(
			failures,
			path,
			proposal.schema_version !== undefined && proposal.schema_version !== PROPOSAL_SCHEMA_VERSION,
			`schema_version musí být ${PROPOSAL_SCHEMA_VERSION}`,
		);

		if (proposal.id !== undefined) {
			pushIf(
				failures,
				path,
				!isNonEmptyString(proposal.id) || !ID_PATTERN.test(proposal.id),
				`id musí mít tvar prop-YYYY-MM-DD-NNN (${proposal.id})`,
			);
			if (isNonEmptyString(proposal.id)) {
				const previous = seenIds.get(proposal.id);
				pushIf(
					failures,
					path,
					previous !== undefined,
					`duplicitní id ${proposal.id} (už používá ${previous})`,
				);
				seenIds.set(proposal.id, path);
			}
		}

		if (proposal.slug !== undefined) {
			pushIf(
				failures,
				path,
				!isNonEmptyString(proposal.slug) || !SLUG_PATTERN.test(proposal.slug),
				`slug musí být kebab-case (${proposal.slug})`,
			);
			pushIf(
				failures,
				path,
				isNonEmptyString(proposal.slug) && proposal.slug !== folder,
				`slug "${proposal.slug}" musí odpovídat názvu složky "${folder}"`,
			);
		}

		for (const field of ['title', 'owner', 'summary']) {
			pushIf(
				failures,
				path,
				proposal[field] !== undefined && !isNonEmptyString(proposal[field]),
				`${field} musí být neprázdný string`,
			);
		}

		pushIf(
			failures,
			path,
			proposal.status !== undefined && !PROPOSAL_STATUSES.includes(proposal.status),
			`status musí být jeden z: ${PROPOSAL_STATUSES.join(', ')}`,
		);

		for (const field of ['created_at', 'updated_at']) {
			pushIf(
				failures,
				path,
				proposal[field] !== undefined && !isValidDate(proposal[field]),
				`${field} musí být platné datum YYYY-MM-DD`,
			);
		}

		if (proposal.wireframe !== undefined) {
			if (!isSafeRelativePath(proposal.wireframe)) {
				failures.push(`${path}: wireframe musí být relativní cesta uvnitř složky proposalu`);
			} else {
				pushIf(
					failures,
					path,
					!proposal.wireframe.endsWith('.html'),
					`wireframe musí být HTML soubor (${proposal.wireframe})`,
				);
				const wireframeReal = resolveRegularFileInside(folderPath, proposal.wireframe);
				if (wireframeReal === null) {
					failures.push(
						`${path}: wireframe neexistuje nebo není běžný soubor uvnitř složky proposalu: ${proposal.wireframe}`,
					);
				} else {
					const html = readFileSync(wireframeReal, 'utf8');
					pushIf(
						failures,
						path,
						EXTERNAL_TAG_PATTERN.test(html) ||
							EXTERNAL_CSS_JS_PATTERN.test(html) ||
							EXTERNAL_SRCSET_PATTERN.test(html),
						'wireframe musí být self-contained offline; heuristika našla externí resource (tag src/href/srcset/base, CSS url()/@import, fetch nebo import z URL)',
					);
				}
			}
		}

		if (proposal.design_notes !== undefined) {
			pushIf(
				failures,
				path,
				!isSafeRelativePath(proposal.design_notes) ||
					resolveRegularFileInside(folderPath, proposal.design_notes) === null,
				`design_notes neexistuje nebo není běžný soubor uvnitř složky proposalu: ${proposal.design_notes}`,
			);
		}

		const devCode = proposal.dev_code;
		const requiresPlan = STATUSES_REQUIRING_PLAN.includes(proposal.status);
		if (devCode === undefined || devCode === null) {
			pushIf(
				failures,
				path,
				requiresPlan,
				`status ${proposal.status} vyžaduje dev_code existujícího Mission Control plánu`,
			);
		} else if (!isNonEmptyString(devCode) || !DEV_CODE_PATTERN.test(devCode)) {
			failures.push(`${path}: dev_code musí mít tvar PREFIX-XXXX (${devCode})`);
		} else if (loadError === null) {
			const planRecord = plansByDevCode.get(devCode);
			if (planRecord === undefined) {
				failures.push(`${path}: dev_code ${devCode} neodpovídá žádnému Mission Control plánu`);
			} else if (requiresPlan) {
				const proposalPrefix = `${PROPOSALS_DIR}/${folder}/`;
				const planLinks = Array.isArray(planRecord.plan.links) ? planRecord.plan.links : [];
				const linkedBack = planLinks.some(
					(link: ParsedData) =>
						isNonEmptyString(link?.path) &&
						(link.path === `${PROPOSALS_DIR}/${folder}` || link.path.startsWith(proposalPrefix)),
				);
				pushIf(
					failures,
					path,
					!linkedBack,
					`status ${proposal.status} vyžaduje, aby plán ${devCode} (${planRecord.path}) citoval proposal v links`,
				);
			}
		}

		validateLinks(failures, path, proposal.links, root);
	}

	return failures;
}

export function formatProposalsSummary(records: ProposalRecord[]): string {
	const counts = new Map();
	for (const record of records) {
		const status = record.proposal?.status ?? 'invalid';
		counts.set(status, (counts.get(status) ?? 0) + 1);
	}
	const parts = [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([status, count]) => `${status}=${count}`);
	const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
	return `Proposals v pořádku: ${records.length} proposalů${detail}`;
}
