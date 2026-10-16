import { readFile, realpath } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { WORKSPACE_ROOT } from './paths.ts';
import { loadProposals, validateProposalRecords } from './vendor/proposals-lib.ts';

// Proposals čtou stejnou knihovnu jako scripts/check-proposals.mjs a
// bun run proposals; aplikace validační pravidla neduplikuje.

export const PROPOSAL_FILES_PREFIX = '/proposal-files/';

const PROPOSAL_MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.md': 'text/plain; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

// Offline kontrakt wireframů platí i za běhu: HTML odpovědi nesou
// restriktivní CSP bez connect-src, externích zdrojů, formulářů a base.
const WIREFRAME_CSP = [
	"default-src 'none'",
	"img-src 'self' data:",
	"media-src 'self'",
	"font-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"script-src 'self' 'unsafe-inline'",
	"connect-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
	"object-src 'none'",
	'sandbox allow-scripts',
].join('; ');

export type ProposalsApiItem = {
	folder: string;
	path: string;
	proposal: unknown;
	parse_error: string | null;
	wireframe_href: string | null;
	design_notes_href: string | null;
};

export type ProposalsApiResponse = {
	proposals: ProposalsApiItem[];
	failures: string[];
};

function fileHref(folder: string, relativeFile: string | undefined): string | null {
	if (!relativeFile) return null;
	const encoded = relativeFile
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
	return `${PROPOSAL_FILES_PREFIX}${encodeURIComponent(folder)}/${encoded}`;
}

export function buildProposalsResponse(): ProposalsApiResponse {
	const records = loadProposals(WORKSPACE_ROOT);
	const failures = validateProposalRecords(records, WORKSPACE_ROOT);
	return {
		proposals: records.map((record) => ({
			folder: record.folder,
			path: record.path,
			proposal: record.proposal,
			parse_error: record.parseError,
			wireframe_href: fileHref(record.folder, record.proposal?.wireframe),
			design_notes_href: fileHref(record.folder, record.proposal?.design_notes),
		})),
		failures,
	};
}

function textResponse(status: number, message: string): Response {
	return new Response(message, {
		status,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
		},
	});
}

export async function serveProposalFile(pathname: string): Promise<Response> {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return textResponse(400, 'Neplatné URL kódování cesty');
	}
	const parts = decoded.split('/').filter((part) => part.length > 0);
	const [, slug, ...fileParts] = parts;
	const records = loadProposals(WORKSPACE_ROOT);
	const record = records.find((item) => item.folder === slug);
	if (!record) {
		return textResponse(404, `Neznámý proposal: ${slug ?? '(chybí slug)'}`);
	}
	const relativeFile =
		fileParts.length > 0 ? fileParts.join('/') : (record.proposal?.wireframe ?? 'index.html');
	const filePath = normalize(join(record.folderPath, relativeFile));
	if (!filePath.startsWith(record.folderPath + sep)) {
		return textResponse(403, 'Cesta mimo složku proposalu');
	}
	let realFilePath: string;
	let realFolderPath: string;
	try {
		realFilePath = await realpath(filePath);
		realFolderPath = await realpath(record.folderPath);
	} catch {
		return textResponse(404, `Soubor nenalezen: ${relativeFile}`);
	}
	if (!realFilePath.startsWith(realFolderPath + sep)) {
		return textResponse(403, 'Cesta mimo složku proposalu (symlink)');
	}
	try {
		const body = await readFile(realFilePath);
		const contentType = PROPOSAL_MIME[extname(realFilePath)] ?? 'application/octet-stream';
		// CSP nese každá odpověď (i SVG je navigovatelný dokument se skripty)
		// a nosniff brání MIME confusion: write API serveru je bez auth.
		return new Response(body, {
			status: 200,
			headers: {
				'content-type': contentType,
				'cache-control': 'no-store',
				'content-security-policy': WIREFRAME_CSP,
				'x-content-type-options': 'nosniff',
			},
		});
	} catch {
		return textResponse(404, `Soubor nenalezen: ${relativeFile}`);
	}
}
