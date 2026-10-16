import {
	buildCurrentAgentWorkResponse,
	formatAgentWorkCliOutput,
	parseAgentWorkCliFormat,
} from './agent-work.ts';

export async function runAgentWorkCli(args = Bun.argv.slice(2)): Promise<void> {
	const format = parseAgentWorkCliFormat(args);
	const response = await buildCurrentAgentWorkResponse();
	process.stdout.write(formatAgentWorkCliOutput(response, format));
}

if (import.meta.main) {
	runAgentWorkCli().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
