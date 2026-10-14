import { program } from 'commander';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PATH_ROOT, showError } from '../utils';
import { Lockfile, type RawLockfile } from './check';

/**
 * The `package.json` fields npm copies into the lockfile's root entry
 * @see {@link https://github.com/npm/cli/blob/v11.17.0/workspaces/arborist/lib/shrinkwrap.js pkgMetaKeys}
 */
const PACKAGE_FIELDS = [
    'version',
    'dependencies',
    'peerDependencies',
    'peerDependenciesMeta',
    'optionalDependencies',
    'bundleDependencies',
    'acceptDependencies',
    'funding',
    'engines',
    'os',
    'cpu',
    'libc',
    'license',
    'bin',
    'deprecated',
    'workspaces'
];
/**
 * The keys npm writes first, in this order
 * @see {@link https://github.com/npm/cli/blob/v11.17.0/workspaces/arborist/lib/shrinkwrap.js swKeyOrder}
 */
const KEY_ORDER = [
    'name',
    'version',
    'lockfileVersion',
    'resolved',
    'integrity',
    'requires',
    'packages',
    'dependencies'
];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

export interface SyncResult {
    /**
     * The fields that differ from `package.json`, empty if in sync
     */
    fields: string[];
    /**
     * The synced lockfile, formatted as npm writes it
     */
    text: string;
}

/**
 * @param value The value to test
 * @returns Whether the value is a plain object, as JSON has them
 */
function isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Cleans a `bin` path the way npm does
 * @param binPath The path
 * @returns The path, or an empty string if it leaves the package
 */
function cleanBinPath(binPath: string): string {
    const clean = path.posix.join('.', path.posix.join('/', binPath.replace(/\\|:/g, '/')));

    return clean.startsWith('./') ? '' : clean;
}

/**
 * Normalizes the `package.json` fields that npm normalizes before writing them
 * @param pkg The `package.json` contents
 * @returns A normalized copy
 * @see {@link https://github.com/npm/package-json/blob/v7.0.5/lib/normalize.js}
 */
function normalize(pkg: Record<string, any>): Record<string, any> {
    const out = structuredClone(pkg);

    if (out.bundleDependencies === undefined) {
        out.bundleDependencies = out.bundledDependencies;
    }
    delete out.bundledDependencies;

    if (out.bundleDependencies === true) {
        out.bundleDependencies = Object.keys(out.dependencies ?? {});
    }
    else if (isObject(out.bundleDependencies)) {
        out.bundleDependencies = Object.keys(out.bundleDependencies);
    }
    else if (!Array.isArray(out.bundleDependencies)) {
        delete out.bundleDependencies;
    }

    // An optional dependency is dropped from dependencies
    if (out.dependencies && isObject(out.optionalDependencies)) {
        for (const name in out.optionalDependencies) {
            delete out.dependencies[name];
        }
        if (Object.keys(out.dependencies).length < 1) {
            delete out.dependencies;
        }
    }

    if (typeof out.funding === 'string' && out.funding) {
        out.funding = { url: out.funding };
    }

    if (typeof out.bin === 'string' && out.name) {
        out.bin = { [out.name]: out.bin };
    }
    else if (Array.isArray(out.bin)) {
        out.bin = Object.fromEntries(out.bin.map((bin: string) => [path.posix.basename(bin), bin]));
    }
    if (isObject(out.bin)) {
        const bins: Record<string, string> = {};

        for (const [name, binPath] of Object.entries(out.bin)) {
            const binName = path.posix.basename(cleanBinPath(name));
            const cleanPath = typeof binPath === 'string' ? cleanBinPath(binPath) : '';

            if (binName && cleanPath) {
                bins[binName] = cleanPath;
            }
        }

        out.bin = bins;
    }
    else {
        delete out.bin;
    }

    if (isObject(out.license) && out.license.type) {
        out.license = out.license.type;
    }

    return out;
}

/**
 * Builds the lockfile's root entry from `package.json`, as npm does
 * @param pkg The `package.json` contents
 * @returns The root entry
 * @see {@link https://github.com/npm/cli/blob/v11.17.0/workspaces/arborist/lib/shrinkwrap.js metaFromNode}
 */
function packageEntry(pkg: Record<string, any>): Record<string, any> {
    const normalized = normalize(pkg);
    const entry: Record<string, any> = {};

    for (const field of PACKAGE_FIELDS) {
        const value = normalized[field];

        // npm skips falsy values and empty objects or arrays
        if (value && (typeof value !== 'object' || Object.keys(value).length > 0)) {
            entry[field] = value;
        }
    }

    if (normalized.name) {
        entry.name = normalized.name;
    }
    if (normalized.devDependencies) {
        entry.devDependencies = normalized.devDependencies;
    }

    const scripts = isObject(normalized.scripts) ? normalized.scripts : {};

    if (normalized.hasInstallScript
        || INSTALL_SCRIPTS.some((script) => typeof scripts[script] === 'string' && scripts[script])) {
        entry.hasInstallScript = true;
    }

    return entry;
}

/**
 * Orders keys the way npm does: scalars and arrays before objects,
 * then the keys in {@link KEY_ORDER}, then the rest in English order
 * @param a The first key and its value
 * @param b The second key and its value
 * @returns A negative number if `a` goes first
 * @see {@link https://github.com/isaacs/json-stringify-nice}
 */
function compareEntries(
    [a, x]: [string, unknown],
    [b, y]: [string, unknown]
): number {
    if (isObject(x) !== isObject(y)) {
        return isObject(x) ? 1 : -1;
    }

    const [i, j] = [KEY_ORDER.indexOf(a), KEY_ORDER.indexOf(b)];

    if (i < 0 && j < 0) {
        return a.localeCompare(b, 'en');
    }

    return (i < 0 ? KEY_ORDER.length : i) - (j < 0 ? KEY_ORDER.length : j);
}

/**
 * Formats a lockfile as npm writes it
 * @param lockfile The lockfile
 * @param indent The indentation
 * @param newline The line ending
 * @returns The lockfile text
 */
function stringify(lockfile: unknown, indent: string, newline: string): string {
    const text = JSON.stringify(lockfile, (_key, value: unknown) => isObject(value)
        ? Object.fromEntries(Object.entries(value).sort(compareEntries))
        : value, indent);

    return `${text}\n`.replaceAll('\n', newline);
}

/**
 * Syncs a lockfile's name, version and root entry with `package.json`
 * @param packageText The `package.json` text, which also sets the formatting
 * @param lockfile The lockfile
 * @param projectDir The directory holding both files
 * @returns The fields that differ and the synced lockfile
 */
export function syncPackage(
    packageText: string,
    lockfile: RawLockfile,
    projectDir: string
): SyncResult {
    assert.ok('packages' in lockfile && isObject(lockfile.packages),
        'Lockfile has no root entry: migrate it with `npm i --package-lock-only`');

    const pkg: unknown = JSON.parse(packageText);

    assert.ok(isObject(pkg),
        'Invalid package.json: package.json should be an object');

    const oldEntry: Record<string, any> = lockfile.packages[''] ?? {};
    const entry = packageEntry(pkg);
    // Without a name, npm names the package after its directory, keeping a scope
    const scope = path.basename(path.dirname(projectDir));
    const folderName = path.basename(projectDir);
    const synced: Record<string, any> = {
        ...lockfile,
        name: pkg.name || (scope.startsWith('@') ? `${scope}/${folderName}` : folderName),
        packages: { ...lockfile.packages, '': entry }
    };
    const fields = new Set<string>();

    // npm leaves out an empty root entry
    if (Object.keys(entry).length < 1) {
        delete synced.packages[''];
    }
    // Without a version, npm keeps the lockfile's
    if (pkg.version) {
        synced.version = pkg.version;
    }

    for (const key of ['name', 'version'] as const) {
        if (lockfile[key] !== synced[key]) {
            fields.add(key);
        }
    }
    for (const key of new Set([...Object.keys(oldEntry), ...Object.keys(entry)])) {
        if (!isDeepStrictEqual(oldEntry[key], entry[key])) {
            fields.add(key);
        }
    }

    // npm takes the formatting from package.json
    const [, newline = '', indent = ''] = /^\s*[{[]((?:\r?\n)+)([\s\t]*)/.exec(packageText) ?? [];

    return {
        fields: [...fields].sort(),
        text: stringify(synced, indent || '  ', newline || '\n')
    };
}

/**
 * CLI command to sync a lockfile with its `package.json`
 * @param lockfilePath Path to the project directory or lockfile
 * @param options The command options
 */
async function syncPackageAction(
    lockfilePath: string,
    options: { dryRun?: boolean }
): Promise<void> {
    try {
        assert.ok(lockfilePath,
            'Missing path to project directory or lockfile');

        const [lockfile, resolvedPath] = await Lockfile.read(path.resolve(PATH_ROOT, lockfilePath));

        Lockfile.validate(lockfile);

        const projectDir = path.dirname(resolvedPath);
        const packageText = await fs.promises.readFile(path.join(projectDir, 'package.json'), 'utf8');
        const { fields, text } = syncPackage(packageText, lockfile, projectDir);

        if (fields.length < 1) {
            return;
        }

        const list = `- ${fields.join('\n- ')}`;

        assert.ok(!options.dryRun,
            `Lockfile out of sync with package.json:\n${list}`);
        await fs.promises.writeFile(resolvedPath, text);
        console.log(`Synced lockfile with package.json:\n${list}`);
    }
    catch (err) {
        showError(err);
    }
}

program
    .command('sync-package')
    .description('Sync a lockfile with its package.json, as npm does')
    .argument('<lockfile>', 'Path to the project directory or lockfile')
    .option('--dry-run', 'Report the differences without writing them')
    .action(syncPackageAction);
