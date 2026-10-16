import path from 'node:path';

type RelativePathImplementation = Pick<typeof path, 'relative' | 'sep'>;

/**
 * Serialize an OS-native relative filesystem path as a portable repository
 * reference. Containment remains the caller's responsibility.
 */
export function portableRelativePath(
	from: string,
	to: string,
	implementation: RelativePathImplementation = path,
): string {
	return implementation.relative(from, to).split(implementation.sep).join('/');
}
