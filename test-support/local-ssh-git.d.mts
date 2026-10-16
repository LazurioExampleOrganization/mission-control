import type path from "node:path";

export function installLocalSshGitTransport(): () => void;
export function localSshRemoteUrl(
	repositoryPath: string,
	pathImplementation?: typeof path.posix | typeof path.win32,
): string;
export function seedMissionControlDataFixture(
	repositoryPath: string,
	options: {
		remote: string;
		organizationAdmin?: string;
	},
): void;
