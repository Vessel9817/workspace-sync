import { program } from 'commander';
import assert from 'node:assert';
import fs, { type PathLike } from 'node:fs';

export const SUPPORTED_LOCKFILE_VERSIONS = new Set([3]);
/**
 * @see {@link https://github.com/SchemaStore/schemastore/blob/0c09eaee518187f3ed6885467cccb67026835394/src/schemas/json/package.json#L381 package.json schema}
 */
export const PACKAGE_NAME_REGEX = `(?:(?:@(?:[a-z0-9-*~][a-z0-9-*._~]*)?/[a-z0-9-._~])|[a-z0-9-~])[a-z0-9-._~]*`;

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
    assert.ok('packages' in lockfile, 'Invalid lockfile');
    assert.ok(typeof lockfile.packages === 'object', 'Invalid lockfile');
    assert.ok(lockfile.packages !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(lockfile.packages), 'Invalid lockfile');

    // Validating packages
    const pkgsIn = lockfile.packages as Record<any, unknown>;
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

    for (const [name, workspacePkgVers] of workspace) {
        const basePkgVers = base.get(name);

        assert.ok(basePkgVers != null,
            `Package missing from base lockfile: ${name}`);
        
        const missingVers = [
            ...workspacePkgVers.difference(basePkgVers)
        ];

        assert.ok(missingVers.length < 1,
            `Version mismatch: ${name}@${missingVers.join('||')}`);
    }
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
    assert.ok(baseLockfile,
        'Missing path to project lockfile');
    assert.ok(workspaceLockfile,
        'Missing path to workspace lockfile');
    await assert.doesNotReject(check(baseLockfile, workspaceLockfile));
}

program
    .command('check')
    .description('Check workspace lockfile sync')
    .argument('<base_lockfile>', 'Path to the project root lockfile')
    .argument('<workspace_lockfile>', 'Path to the workspace lockfile')
    .action(checkAction);
