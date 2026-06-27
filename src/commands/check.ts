import { program } from 'commander';
import assert from 'node:assert';
import fs, { type PathLike } from 'node:fs';
import path from 'node:path';
import { getOrInsert } from '../shims';
import { cast, PATH_ROOT, pathLikeToString, showError } from '../utils';

export type RawPackage = ({
    link?: false;
    /**
     * If not present, this package is a peer/optional dependency
     * that's not installed
     */
    version?: string;
} & {
    /**
     * If present, this package is a workspace.
     * Otherwise, this package is an ordinary dependency.
     */
    name?: string;
    version: string;
}) | {
    // Local source
    link: true;
    //resolved: string;
};

export type RawLockfile = {
    name: string;
    version: string;
    //workspaces?: string[] | {
    //    packages: string[];
    //};
} & ({
    lockfileVersion: 1;
    dependencies?: Record<string, RawPackage>;
} | {
    lockfileVersion: 2;
    packages: Record<string, RawPackage>;
    dependencies?: Record<string, RawPackage>;
} | {
    lockfileVersion: 2;
    packages?: Record<string, RawPackage>;
    dependencies: Record<string, RawPackage>;
} | {
    lockfileVersion: 3;
    packages: Record<string, RawPackage>;
});

export class LockfileBuilder {
    private _path: string | undefined;
    private _name: string | undefined;
    private _version: string | undefined;
    private _packages: Map<string, Package> | undefined;
    private _workspaces: Map<string, Package> | undefined;

    setPath(path: string): this {
        this._path = path;

        return this;
    }

    setName(name: string): this {
        this._name = name;

        return this;
    }

    setVersion(version: string): this {
        this._version = version;

        return this;
    }

    setPackages(packages: Map<string, Package>): this {
        this._packages = packages;

        return this;
    }

    setWorkspaces(workspaces: Map<string, Package>): this {
        this._workspaces = workspaces;

        return this;
    }

    create(): Lockfile {
        assert.ok(this._name !== undefined, '');
        assert.ok(this._version !== undefined, '');

        return new Lockfile(
            this._path ?? process.cwd(),
            this._name,
            this._version,
            this._packages ?? new Map(),
            this._workspaces ?? new Map()
        );
    }
}

export class Lockfile {
    static readonly SUPPORTED_VERSIONS = new Set([1, 2, 3]);
    /**
     * Ordered from highest to lowest precedence
     */
    static readonly SUPPORTED_NAMES = [
        'npm-shrinkwrap.json',
        'package-lock.json'
    ];
    /**
     * @see {@link https://github.com/SchemaStore/schemastore/issues/5230}
     */
    static readonly PACKAGE_NAME_REGEX = `(?:@[^/]+/)[^/]+`;

    readonly path: string;
    readonly name: string;
    readonly version: string;
    readonly packages: Map<string, Package>;
    readonly workspaces: Map<string, Package>;

    constructor(
        path: string,
        name: string,
        version: string,
        packages: Map<string, Package>,
        workspaces: Map<string, Package>
    ) {
        this.path = path;
        this.name = name;
        this.version = version;
        this.packages = packages;
        this.workspaces = workspaces;
    }

    static validate(lockfile: unknown): asserts lockfile is RawLockfile {
        // Validating lockfile properties
        assert.ok(typeof lockfile === 'object',
            'Invalid lockfile: lockfile should be an object');
        assert.ok(lockfile !== null,
            'Invalid lockfile: lockfile is null');
        assert.ok(!Array.isArray(lockfile),
            'Invalid lockfile: lockfile is an array');
        assert.ok('lockfileVersion' in lockfile,
            'Invalid lockfile: missing lockfileVersion');
        assert.ok(typeof lockfile.lockfileVersion === 'number',
            'Invalid lockfile: lockfileVersion should be a number');
        assert.ok(Lockfile.SUPPORTED_VERSIONS.has(lockfile.lockfileVersion),
            `Unsupported lockfile version: ${lockfile.lockfileVersion}`);
        assert.ok('version' in lockfile,
            'Invalid lockfile: missing version');
        assert.ok(typeof lockfile.version === 'string',
            'Invalid lockfile: version should be a string');
        assert.ok('name' in lockfile,
            'Invalid lockfile: missing name');
        assert.ok(typeof lockfile.name === 'string',
            'Invalid lockfile: name should be a string');
        assert.ok(new RegExp(`^${Lockfile.PACKAGE_NAME_REGEX}$`).test(lockfile.name),
            'Invalid lockfile: invalid name');
        const packageKey = 'packages' in lockfile ? 'packages' : 'dependencies';
        const oldPackageKeyAllowed = lockfile.lockfileVersion < 3;

        if (lockfile.lockfileVersion === 1) {
            assert.ok(!('packages' in lockfile),
                'Invalid lockfile: lockfileVersion should be migrated to 2+');
        }
        else if (!oldPackageKeyAllowed) {
            assert.ok(!('dependencies' in lockfile),
                'Invalid lockfile: dependencies should be migrated to packages');
        }

        assert.ok(packageKey in lockfile,
            `Invalid lockfile: missing packages${oldPackageKeyAllowed ? ' or dependencies' : ''}`);

        const packages = (lockfile as typeof lockfile & Record<typeof packageKey, unknown>)[packageKey];

        assert.ok(typeof packages === 'object',
            `Invalid lockfile: ${packageKey} should be an object`);
        assert.ok(packages !== null,
            `Invalid lockfile: ${packageKey} is null`);
        assert.ok(!Array.isArray(packages),
            `Invalid lockfile: ${packageKey} is an array`);
        cast<Record<string, unknown>>(packages);

        // Validating packages
        for (const pkgPath in packages) {
            const pkg: unknown = packages[pkgPath];

            assert.ok(typeof pkgPath === 'string',
                `Invalid lockfile: ${packageKey} key should be a string`);
            assert.ok(typeof pkg === 'object',
                'Invalid lockfile: package should be an object');
            assert.ok(pkg !== null,
                'Invalid lockfile: package is null');
            assert.ok(!Array.isArray(pkg),
                'Invalid lockfile: package is an array');

            if ('link' in pkg) {
                assert.ok(typeof pkg.link === 'boolean',
                    'Invalid lockfile: package link should be a boolean');

                if (pkg.link === true) {
                    // Local source
                    continue;
                }
            }
            if (!('version' in pkg)) {
                // Peer/optional dep that's not installed
                continue;
            }
            if ('name' in pkg) {
                // Workspace
                assert.ok(typeof pkg.name === 'string',
                    'Invalid lockfile: package name should be a string');
            }
            else {
                // Dependency
                assert.ok(typeof pkg.version === 'string',
                    'Invalid lockfile: package version must be a string');

                const pkgNameMatches = new RegExp(`(?<name>${Lockfile.PACKAGE_NAME_REGEX})$`).exec(pkgPath);
                const pkgName = pkgNameMatches?.groups?.name;

                assert.ok(pkgName !== undefined,
                    'Invalid lockfile: package name should be a string');
            }
        }
    }

    /**
     * Given a lockfile, validates and parses it
     * @param lockfile The lockfile, as JSON
     * @param lockfilePath The absolute path to the lockfile
     * @returns The parsed lockfile
     */
    static parse(
        lockfile: RawLockfile,
        lockfilePath: string
    ): Lockfile {
        const pkgsIn = 'packages' in lockfile
            ? lockfile['packages']
            : lockfile['dependencies'];
        const pkgsOut = new Map<string, Package>();
        let workspaces = new Map<string, Package>();

        // Collecting package versions
        for (const pkgPath in pkgsIn) {
            const pkg = pkgsIn[pkgPath];

            if (pkgPath === '') {
                // Current workspace
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

            if ('name' in pkg) {
                // Workspace
                const fullPkgPath = path.resolve(path.dirname(lockfilePath), pkgPath);

                getOrInsert(workspaces, fullPkgPath, { versions: new Set() }).versions.add(pkg.version);
            }
            else {
                const pkgNameMatches = new RegExp(`(?<name>${Lockfile.PACKAGE_NAME_REGEX})$`).exec(pkgPath);
                const pkgName = pkgNameMatches?.groups?.name;

                assert.ok(pkgName !== undefined,
                    'Invalid lockfile: package name is missing');

                getOrInsert(pkgsOut, pkgName, { versions: new Set() }).versions.add(pkg.version);
            }
        }

        return new LockfileBuilder()
            .setName(lockfile.name)
            .setPath(lockfilePath)
            .setVersion(lockfile.version)
            .setPackages(pkgsOut)
            .setWorkspaces(workspaces)
            .create();
    }

    /**
     * Given a path to a lockfile, returns the raw lockfile
     * @param lockfilePath The lockfile path
     * @returns The lockfile, in raw JSON
     */
    static async readFromFile(
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
     * Given a path to a workspace directory, reads the lockfile
     * @param lockfilePath The directory path
     * @returns If successful, the raw JSON lockfile and its resolved path.
     * If the directory exists, but no lockfile is found, `undefined`.
     */
    static async readFromDir(
        lockfileDir: PathLike
    ): Promise<[any, string] | undefined> {
        const lockfilePath = pathLikeToString(lockfileDir);

        // Trying to read folder
        for (const lockfileName of Lockfile.SUPPORTED_NAMES) {
            try {
                const tempLockfilePath = path.join(lockfilePath, lockfileName);
                const lockfile = await Lockfile.readFromFile(tempLockfilePath);

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

    /**
     * Reads the given lockfile
     * @param lockfilePath Path to the lockfile or its containing directory
     * @returns The lockfile, in raw JSON
     */
    static async read(
        lockfilePath: PathLike
    ): Promise<[any, string]> {
        return await Lockfile.readFromDir(lockfilePath) ?? [
            await Lockfile.readFromFile(lockfilePath),
            pathLikeToString(lockfilePath)
        ];
    }
}

export interface Package {
    versions: Set<string>;
}

/**
 * Checks lockfile workspace sync
 * @param baseLockfile The project root lockfile
 * @param workspaceLockfile The workspace lockfile
 */
export function checkWorkspace(
    baseLockfile: Lockfile,
    workspaceLockfile: Lockfile
): void {
    const workspace = baseLockfile.workspaces.get(path.dirname(workspaceLockfile.path));

    assert.ok(workspace !== undefined,
        'Missing workspace');
    assert.ok(workspace.versions.has(workspaceLockfile.version),
        `Base lockfile out of date: expected workspace version ${workspaceLockfile.version}`);
    assert.ok(workspace.versions.size === 1,
        `Multiple workspace versions used: expected only version ${workspaceLockfile.version}`);
}

/**
 * Checks lockfile package sync
 * @param baseLockfile The project root lockfile
 * @param workspaceLockfile The workspace lockfile
 */
export function checkPackages(
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
 * Checks lockfile sync
 * @param baseLockfile The project root lockfile
 * @param workspaceLockfile The workspace lockfile
 */
export function check(
    baseLockfile: Lockfile,
    workspaceLockfile: Lockfile
): void {
    const errorMsgs = new Array<string>();

    try {
        checkPackages(baseLockfile, workspaceLockfile);
    }
    catch (err) {
        if (err instanceof Error) {
            errorMsgs.push(err.message);
        }
        else {
            throw err;
        }
    }

    try {
        checkWorkspace(baseLockfile, workspaceLockfile);
    }
    catch (err) {
        if (err instanceof Error) {
            errorMsgs.push(err.message);
        }
        else {
            throw err;
        }
    }

    assert.ok(errorMsgs.length < 1, errorMsgs.join('\n'));
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

    try {
        const [base, workspace] = (await Promise.all([
            Lockfile.read(path.resolve(PATH_ROOT, baseLockfilePath)),
            Lockfile.read(path.resolve(PATH_ROOT, workspaceLockfilePath))
        ])).map(([lockfile, lockfilePath]) => {
            Lockfile.validate(lockfile);

            return Lockfile.parse(lockfile, lockfilePath);
        });

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
