import { AssertionError } from "assert";

export function showError(err: unknown): void {
    if (err instanceof AssertionError) {
        console.error(err.message);
    }
    else {
        console.error(err);
    }

    process.exitCode = 1;
}
