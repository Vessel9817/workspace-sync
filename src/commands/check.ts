import { program } from 'commander';
import assert from 'node:assert';
import fs, { type PathLike } from 'node:fs';
import path from 'node:path';
import { PATH_ROOT, pathLikeToString, showError } from '../utils';

export interface Lockfile {
    packages: Map<string, Package>,
}

export interface Package {
    versions: Set<string>;
}

export const SUPPORTED_LOCKFILE_VERSIONS = new Set([1, 2, 3]);
// Ordered from highest to lowest precedence
export const SUPPORTED_LOCKFILE_NAMES = [
    'npm-shrinkwrap.json',
    'package-lock.json'
];
/**
 * @see {@link https://github.com/SchemaStore/schemastore/blob/0c09eaee518187f3ed6885467cccb67026835394/src/schemas/json/package.json#L381 package.json schema}
 */
export const PACKAGE_NAME_REGEX = `(?:(?:@(?:[a-z0-9-*~][a-z0-9-*._~]*)?/[a-z0-9-._~])|[a-z0-9-~])[a-z0-9-._~]*`;

async function readLockfileFromFile(
    lockfilePath: PathLike
): Promise<Buffer<ArrayBuffer>> {
    const file = await fs.promises.open(lockfilePath);

    try {
        return await file.readFile();
    }
    finally {
        await file.close();
    }
}

async function readLockfileFromDir(
    lockfileDir: PathLike
): Promise<Buffer<ArrayBuffer> | undefined> {
    const lockfilePath = pathLikeToString(lockfileDir);

    // Trying to read folder
    for (const lockfileName of SUPPORTED_LOCKFILE_NAMES) {
        try {
            return await readLockfileFromFile(path.join(lockfilePath, lockfileName));
        }
        catch (err) {
            // If the file doesn't exist, keep looping
            if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') {
                throw err;
            }
        }
    }
}

/**
 * Given a lockfile, validates and parses it
 * @param lockfile The lockfile, as JSON
 * @returns The parsed lockfile
 */
export function parseLockfile(lockfile: unknown): Lockfile {
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

    const pkgsIn = packages as Record<any, unknown>;
    const pkgsOut = new Map<string, Package>();

    for (const pkgPath in pkgsIn) {
        // Validating package
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

        // Collecting package versions
        const pkgNameMatches = new RegExp(`(?<name>${PACKAGE_NAME_REGEX})$`).exec(pkgPath);
        const pkgName = pkgNameMatches?.groups?.name;

        assert.ok(pkgName != null && pkgName.length > 0, 'Invalid lockfile');

        if (pkgsOut.has(pkgName)) {
            pkgsOut.get(pkgName)!.versions.add(pkg.version);
        }
        else {
            pkgsOut.set(pkgName, { versions: new Set([pkg.version]) });
        }
    }

    return {
        packages: pkgsOut
    };
}

/**
 * Reads and parses the given lockfile
 * @param lockfilePath Path to the lockfile or its containing directory
 * @returns
 */
export async function readLockfile(
    lockfilePath: PathLike
): Promise<Lockfile> {
    const contents = await readLockfileFromDir(lockfilePath)
        ?? await readLockfileFromFile(lockfilePath);

    return parseLockfile(JSON.parse(contents.toString()));
}

/**
 * Checks workspace lockfile sync
 * @param baseLockfilePath Path to the project root lockfile
 * @param workspaceLockfilePath Path to the workspace lockfile
 */
export async function check(
    baseLockfilePath: PathLike,
    workspaceLockfilePath: PathLike
): Promise<void> {
    assert.ok(baseLockfilePath,
        'Missing path to project root directory or lockfile');
    assert.ok(workspaceLockfilePath,
        'Missing path to workspace directory or lockfile');

    const files = [baseLockfilePath, workspaceLockfilePath];
    const [base, workspace] = await Promise.all(files.map(readLockfile));
    const missingPkgs = new Array<string>();

    for (const [name, workspacePkg] of workspace.packages) {
        const basePkg = base.packages.get(name);

        if (basePkg == null) {
            missingPkgs.push(name);
        }
        else if (!workspacePkg.versions.isSubsetOf(basePkg.versions)) {
            const missingVers = [
                ...workspacePkg.versions.difference(basePkg.versions)
            ];

            missingPkgs.push(`${name}@${missingVers.join('||')}`);
        }
    }

    assert.ok(missingPkgs.length < 1,
        `Packages missing from project root lockfile:\n- ${missingPkgs.join('\n- ')}`);
}

/**
 * CLI command to check workspace lockfile sync
 * @param baseLockfilePath 
 * @param workspaceLockfilePath 
 */
async function checkAction(
    baseLockfilePath: string,
    workspaceLockfilePath: string
): Promise<void> {
    baseLockfilePath = path.resolve(PATH_ROOT, baseLockfilePath);
    workspaceLockfilePath = path.resolve(PATH_ROOT, workspaceLockfilePath);

    try {
        await check(baseLockfilePath, workspaceLockfilePath);
    }
    catch (err) {
        showError(err);
    }
}

program
    .command('check')
    .description('Check workspace lockfile sync')
    .argument('<base_lockfile>', 'Path to the project root directory or lockfile')
    .argument('<workspace_lockfile>', 'Path to the workspace directory or lockfile')
    .action(checkAction);
