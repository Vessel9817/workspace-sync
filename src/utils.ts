import { type PathLike } from 'fs';
import { fileURLToPath } from 'url';

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
