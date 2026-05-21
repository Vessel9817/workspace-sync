import { program } from 'commander';
import assert from 'node:assert';
import fs, { type PathLike } from 'node:fs';
import { showError } from '../utils';

export const SUPPORTED_LOCKFILE_VERSIONS = new Set([1, 2, 3]);
/**
 * @see {@link https://github.com/SchemaStore/schemastore/blob/0c09eaee518187f3ed6885467cccb67026835394/src/schemas/json/package.json#L381 package.json schema}
 */
export const PACKAGE_NAME_REGEX = `(?:(?:@(?:[a-z0-9-*~][a-z0-9-*._~]*)?/[a-z0-9-._~])|[a-z0-9-~])[a-z0-9-._~]*`;

/**
 * Reads the given lockfile as JSON
 * @param lockfilePath
 * @returns
 */
export async function readLockfile(lockfilePath: PathLike): Promise<any> {
    const file = await fs.promises.open(lockfilePath);

    try {
        const contents = (await file.readFile()).toString();

        return JSON.parse(contents);
    }
    finally {
        file.close();
    }
}

/**
 * Given a lockfile, returns data useful for comparing package versions
 * @param lockfile The lockfile, as JSON
 * @returns
 */
export function getPackages(lockfile: unknown): Map<string, Set<string>> {
    // Validating lockfile properties
    assert.ok(typeof lockfile === 'object', 'Invalid lockfile');
    assert.ok(lockfile !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(lockfile), 'Invalid lockfile');
    assert.ok('lockfileVersion' in lockfile, 'Invalid lockfile');
    assert.ok(typeof lockfile['lockfileVersion'] === 'number',
        'Invalid lockfile');
    assert.ok(SUPPORTED_LOCKFILE_VERSIONS.has(lockfile.lockfileVersion),
        `Unsupported lockfile version: ${lockfile['lockfileVersion']}`);

    const packageKey = 'packages' in lockfile ? 'packages' : 'dependencies';

    assert.ok(packageKey in lockfile, 'Invalid lockfile');

    const packages = (lockfile as typeof lockfile & Record<typeof packageKey, unknown>)[packageKey];

    assert.ok(typeof packages === 'object', 'Invalid lockfile');
    assert.ok(packages !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(packages), 'Invalid lockfile');

    // Validating packages
    const pkgsIn = packages as Record<any, unknown>;
    const pkgsOut = new Map<string, Set<string>>();

    for (const pkgPath in pkgsIn) {
        const pkg = pkgsIn[pkgPath];

        if (pkgPath === '') {
            // Package is the workspace
            continue;
        }

        assert.ok(typeof pkgPath === 'string', 'Invalid lockfile');
        assert.ok(typeof pkg === 'object', 'Invalid lockfile');
        assert.ok(pkg !== null, 'Invalid lockfile');
        assert.ok(!Array.isArray(pkg), 'Invalid lockfile');

        if ('name' in pkg) {
            // Workspace
            assert.ok(typeof pkg.name === 'string', 'Invalid lockfile');
            continue;
        }
        if ('link' in pkg && pkg.link === true) {
            // Local source
            continue;
        }
        if (!('version' in pkg)) {
            // Peer dep or optional dep that's not installed
            continue;
        }

        assert.ok(typeof pkg.version === 'string', 'Invalid lockfile');

        // Collecting packages
        const pkgNameMatches = new RegExp(`(?<name>${PACKAGE_NAME_REGEX})$`).exec(pkgPath);
        const pkgName = pkgNameMatches?.groups?.name;

        assert.ok(pkgName != null && pkgName.length > 0, 'Invalid lockfile');

        if (pkgsOut.has(pkgName)) {
            pkgsOut.get(pkgName)!.add(pkg.version);
        }
        else {
            pkgsOut.set(pkgName, new Set([pkg.version]));
        }
    }

    return pkgsOut;
}

/**
 * Checks workspace lockfile sync
 * @param baseLockfile Path to the project root lockfile
 * @param workspaceLockfile Path to the workspace lockfile
 */
export async function check(
    baseLockfile: PathLike,
    workspaceLockfile: PathLike
): Promise<void> {
    const files = [baseLockfile, workspaceLockfile];
    const [base, workspace] = (await Promise.all(files.map(readLockfile))).map(getPackages);
    const missingPkgs: string[] = [];

    for (const [name, workspacePkgVers] of workspace) {
        const basePkgVers = base.get(name);

        if (basePkgVers == null) {
            missingPkgs.push(name);
        }
        else if (!workspacePkgVers.isSubsetOf(basePkgVers)) {
            const missingVers = [
                ...workspacePkgVers.difference(basePkgVers)
            ];

            missingPkgs.push(`${name}@${missingVers.join('||')}`);
        }
    }

    assert.ok(missingPkgs.length < 1,
        `Packages missing from project root lockfile:\n- ${missingPkgs.join('\n- ')}`);
}

/**
 * CLI command to check workspace lockfile sync
 * @param baseLockfile 
 * @param workspaceLockfile 
 */
async function checkAction(
    baseLockfile: string,
    workspaceLockfile: string
): Promise<void> {
    try {
        assert.ok(baseLockfile,
            'Missing path to project lockfile');
        assert.ok(workspaceLockfile,
            'Missing path to workspace lockfile');
        await check(baseLockfile, workspaceLockfile);
    }
    catch (err) {
        showError(err);
    }
}

program
    .command('check')
    .description('Check workspace lockfile sync')
    .argument('<base_lockfile>', 'Path to the project root lockfile')
    .argument('<workspace_lockfile>', 'Path to the workspace lockfile')
    .action(checkAction);
