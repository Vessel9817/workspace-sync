import { program } from 'commander';
import assert from 'node:assert';
import fs, { type PathLike } from 'node:fs';
import path from 'node:path';
import { PATH_ROOT, pathLikeToString, showError } from '../utils';

export interface Lockfile {
    path: string,
    packages: Map<string, Package>,
    workspaces: Set<string>
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

/**
 * Given a path to a lockfile, returns the lockfile as JSON
 * @param lockfilePath The lockfile path
 * @returns The lockfile, in JSON
 */
export async function readLockfileFromFile(
    lockfilePath: PathLike
): Promise<any> {
    const file = await fs.promises.open(lockfilePath);

    try {
        return JSON.parse((await file.readFile()).toString());
    }
    finally {
        await file.close();
    }
}

/**
 * Given a path to a workspace directory, validates and parses the lockfile
 * @param lockfilePath The directory path
 * @returns If successful, the parsed lockfile and its resolved path.
 * If the directory exists, but no lockfile is found, `undefined`.
 */
export async function readLockfileFromDir(
    lockfileDir: PathLike
): Promise<[any, string] | undefined> {
    const lockfilePath = pathLikeToString(lockfileDir);

    // Trying to read folder
    for (const lockfileName of SUPPORTED_LOCKFILE_NAMES) {
        try {
            const tempLockfilePath = path.join(lockfilePath, lockfileName);
            const lockfile = await readLockfileFromFile(tempLockfilePath);

            return [lockfile, tempLockfilePath];
        }
        catch (err) {
            // If the file doesn't exist, keep looping
            if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') {
                throw err;
            }
        }
    }
}

function parseLockfilePackages(
    lockfile: Record<string, unknown>,
    lockfilePath: string
): [Map<string, Package>, Set<string>] {
    const packageKey = 'packages' in lockfile ? 'packages' : 'dependencies';

    assert.ok(packageKey in lockfile, 'Invalid lockfile');

    const packages = (lockfile as typeof lockfile & Record<typeof packageKey, unknown>)[packageKey];

    assert.ok(typeof packages === 'object', 'Invalid lockfile');
    assert.ok(packages !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(packages), 'Invalid lockfile');

    const pkgsIn = packages as Record<any, unknown>;
    const pkgsOut = new Map<string, Package>();
    let workspaces = new Set<string>();

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
        let tmpName = pkgPath;

        if ('name' in pkg) {
            // Workspace
            assert.ok(typeof pkg.name === 'string', 'Invalid lockfile');

            workspaces.add(path.resolve(path.dirname(lockfilePath), pkgPath));

            tmpName = pkg.name;
        }

        const pkgNameMatches = new RegExp(`(?<name>${PACKAGE_NAME_REGEX})$`).exec(tmpName);
        const pkgName = pkgNameMatches?.groups?.name;

        assert.ok(pkgName != null, 'Invalid lockfile');

        if ('name' in pkg) {
            // TODO Check workspace versions
            continue;
        }
        else if (pkgsOut.has(pkgName)) {
            pkgsOut.get(pkgName)!.versions.add(pkg.version);
        }
        else {
            pkgsOut.set(pkgName, { versions: new Set([pkg.version]) });
        }
    }

    return [pkgsOut, workspaces];
}

/**
 * Given a lockfile, validates and parses it
 * @param lockfile The lockfile, as JSON
 * @param lockfilePath The absolute path to the lockfile
 * @returns The parsed lockfile
 */
export function parseLockfile(
    lockfile: unknown,
    lockfilePath: string
): Lockfile {
    // Validating lockfile properties
    assert.ok(typeof lockfile === 'object', 'Invalid lockfile');
    assert.ok(lockfile !== null, 'Invalid lockfile');
    assert.ok(!Array.isArray(lockfile), 'Invalid lockfile');
    assert.ok('lockfileVersion' in lockfile, 'Invalid lockfile');
    assert.ok(typeof lockfile.lockfileVersion === 'number',
        'Invalid lockfile');
    assert.ok(SUPPORTED_LOCKFILE_VERSIONS.has(lockfile.lockfileVersion),
        `Unsupported lockfile version: ${lockfile.lockfileVersion}`);

    // Combining workspace sets
    const [pkgs, workspaces] = parseLockfilePackages(lockfile, lockfilePath);

    return {
        path: lockfilePath,
        packages: pkgs,
        workspaces
    };
}

/**
 * Reads the given lockfile
 * @param lockfilePath Path to the lockfile or its containing directory
 * @returns
 */
export async function readLockfile(
    lockfilePath: PathLike
): Promise<[any, string]> {
    return await readLockfileFromDir(lockfilePath) ?? [
        await readLockfileFromFile(lockfilePath),
        pathLikeToString(lockfilePath)
    ];
}

/**
 * Checks workspace lockfile sync
 * @param baseLockfilePath Path to the project root lockfile
 * @param workspaceLockfilePath Path to the workspace lockfile
 */
export function check(
    baseLockfile: Lockfile,
    workspaceLockfile: Lockfile
): void {
    const missingPkgs = new Array<string>();

    for (const [name, workspacePkg] of workspaceLockfile.packages) {
        const basePkg = baseLockfile.packages.get(name);

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
    assert.ok(baseLockfilePath,
        'Missing path to project root directory or lockfile');
    assert.ok(workspaceLockfilePath,
        'Missing path to workspace directory or lockfile');

    const [base, workspace] = (await Promise.all([
        readLockfile(path.resolve(PATH_ROOT, baseLockfilePath)),
        readLockfile(path.resolve(PATH_ROOT, workspaceLockfilePath))
    ])).map(([l, w]) => parseLockfile(l, w));

    try {
        check(base, workspace);
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
