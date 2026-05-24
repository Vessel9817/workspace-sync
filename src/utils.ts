import { type PathLike } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PATH_ROOT = process.cwd();

export function showError(err: unknown): void {
    if (err instanceof Error) {
        console.error(err.message);
    }
    else {
        console.error(err);
    }

    process.exitCode = 1;
}

export function pathLikeToString(pathLike: PathLike): string {
    return pathLike instanceof URL
        ? fileURLToPath(pathLike)
        : pathLike.toString()
}

/**
 * Unsafely casts the given value to a subtype
 * @param x The value to cast
 */
export function cast<T extends U, U = any>(x: U): asserts x is T {} // NOSONAR typescript:S1186
