import { program } from 'commander';
import assert from 'node:assert';
import fs, { type PathLike } from 'node:fs';

program
    .command('check')
    .description('Check workspace lockfile sync')
    .argument('<base_lockfile>', 'Path to the project root lockfile')
    .argument('<workspace_lockfile>', 'Path to the workspace lockfile')
    .action(async (baseLockfile: string, workspaceLockfile: string) => {
        assert.ok(baseLockfile,
            'Missing path to project lockfile');
        assert.ok(workspaceLockfile,
            'Missing path to workspace lockfile');
        await assert.doesNotReject(check(baseLockfile, workspaceLockfile));
    });

export interface Package {
    version: string;
}

export const SUPPORTED_LOCKFILE_VERSIONS = new Set([3]);

/**
 * Reads the given lockfile as JSON
 * @param lockfile
 * @returns
 */
export async function readLockfile(lockfile: PathLike): Promise<any> {
    const file = await fs.promises.open(lockfile);

    try {
        const contents = (await file.readFile()).toString();

        return JSON.parse(contents);
    }
    finally {
        file.close();
    }
}

export function getPackages(lockfile: unknown): Map<string, Package> {
    // Validating lockfile properties
    assert.ok(typeof lockfile === 'object', 'Invalid lockfile');
    assert.ok(lockfile !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(lockfile), 'Invalid lockfile');
    assert.ok('lockfileVersion' in lockfile, 'Invalid lockfile');
    assert.ok(typeof lockfile['lockfileVersion'] === 'number',
        'Invalid lockfile');
    assert.ok(SUPPORTED_LOCKFILE_VERSIONS.has(lockfile.lockfileVersion),
        `Unsupported lockfile version: ${lockfile['lockfileVersion']}`);
    assert.ok('packages' in lockfile, 'Invalid lockfile');
    assert.ok(typeof lockfile.packages === 'object', 'Invalid lockfile');
    assert.ok(lockfile.packages !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(lockfile.packages), 'Invalid lockfile');

    // Validating packages
    const pkgsIn = lockfile.packages as Record<any, unknown>;
    const pkgsOut = new Map<string, Package>();

    for (const name in pkgsIn) {
        if (name === '') {
            // Package is the workspace
            continue;
        }

        const pkg = pkgsIn[name];

        console.log(name); // TODO TESTING

        assert.ok(typeof name === 'string', 'Invalid lockfile');
        assert.ok(typeof pkg === 'object', 'Invalid lockfile');
        assert.ok(pkg !== null, 'Invalid lockfile');
        assert.ok(!Array.isArray(pkg), 'Invalid lockfile');

        if (!('version' in pkg)) {
            // Package is a workspace
            continue;
        }

        assert.ok(typeof pkg.version === 'string', 'Invalid lockfile');
        assert.ok(!('integrity' in pkg) || typeof pkg.integrity === 'string',
            'Invalid lockfile');

        // Collecting packages
        pkgsOut.set(name, { version: pkg.version });
    }

    return pkgsOut;
}

export async function check(
    baseLockfile: PathLike,
    workspaceLockfile: PathLike
): Promise<void> {
    const files = [baseLockfile, workspaceLockfile];
    const [base, workspace] = (await Promise.all(files.map(readLockfile))).map(getPackages);

    for (const [name, pkg] of workspace) {
        const basePkg = base.get(name);

        assert.ok(basePkg != null,
            `Package removed from base lockfile: ${name}`);
        assert.deepStrictEqual(basePkg, pkg,
            `Versions differ in package: ${name}`);
    }
}
