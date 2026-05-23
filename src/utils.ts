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
