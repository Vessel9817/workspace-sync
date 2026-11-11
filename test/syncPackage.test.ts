import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { syncPackage } from '../src/commands';
import { copyFixture, editJson, FIXTURES, PROJECT, run } from './helpers';

const WORKSPACE = path.join(PROJECT, 'packages', 'a');
const CASES = path.join(FIXTURES, 'sync-package');
const LOCKFILE = fs.readFileSync(path.join(WORKSPACE, 'package-lock.json'), 'utf8');
const PACKAGE = fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf8');

/**
 * Syncs a case's package.json into its input lockfile, which defaults to
 * the fixture workspace's lockfile
 * @param name The case directory
 * @returns The input lockfile, the result and npm's lockfile
 */
function syncCase(name: string) {
    const dir = path.join(CASES, name);
    const inputPath = path.join(dir, 'input-lock.json');
    const input = JSON.parse(fs.existsSync(inputPath) ? fs.readFileSync(inputPath, 'utf8') : LOCKFILE);
    const pkg = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');

    return {
        input,
        result: syncPackage(pkg, structuredClone(input), dir),
        expected: fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')
    };
}

describe('syncPackage', () => {
    it('changes nothing when in sync', () => {
        const result = syncPackage(PACKAGE, JSON.parse(LOCKFILE), WORKSPACE);

        assert.deepStrictEqual(result, { fields: [], text: LOCKFILE });
    });

    for (const [name, fields] of [
        ['range-bump', ['dependencies']],
        ['name-version', ['name', 'version']],
        ['normalized', ['bin', 'engines', 'funding', 'hasInstallScript', 'license']],
        ['key-order', ['engines']],
        ['tab-indent', ['dependencies']],
        ['crlf', ['dependencies']],
        ['lockfile-v2', ['dependencies']],
        ['empty-dev-deps', ['devDependencies']],
        ['no-version', ['version']]
    ] as const) {
        it(`writes what npm writes: ${name}`, () => {
            const { result, expected } = syncCase(name);

            assert.deepStrictEqual(result.fields, fields);
            assert.strictEqual(result.text, expected);
        });
    }

    for (const [name, fields] of [
        ['add-dependency', ['dependencies']],
        ['optional-dedupe', ['dependencies', 'optionalDependencies']],
        ['bundle-true', ['bundleDependencies']],
        ['bundled-typo', ['bundleDependencies']]
    ] as const) {
        it(`writes the root entry npm writes, but no other entry: ${name}`, () => {
            const { input, result, expected } = syncCase(name);
            const { packages: { '': entry, ...others }, ...topLevel } = JSON.parse(result.text);
            const { packages: { '': npmEntry }, ...npmTopLevel } = JSON.parse(expected);
            const inputOthers = Object.fromEntries(
                Object.entries(input.packages).filter(([key]) => key !== '')
            );

            assert.deepStrictEqual(result.fields, fields);
            assert.deepStrictEqual(entry, npmEntry);
            assert.deepStrictEqual(topLevel, npmTopLevel);
            assert.deepStrictEqual(others, inputOthers);
        });
    }

    it('keeps the line endings of package.json', () => {
        const { result } = syncCase('crlf');

        assert.ok(result.text.includes('\r\n'), 'Fixture should have CRLF line endings');
        assert.ok(!/[^\r]\n/.test(result.text), 'Every line should end with CRLF');
    });

    it('leaves out an empty root entry, as npm does', () => {
        const { result, expected } = syncCase('empty-root');

        assert.deepStrictEqual(result.fields, ['name', 'version']);
        assert.strictEqual(result.text, expected);
        assert.ok(!('' in JSON.parse(result.text).packages), 'Root entry should be left out');
    });

    it('ignores fields npm leaves out of the lockfile', () => {
        const pkg = JSON.parse(PACKAGE);

        pkg.description = 'Ignored';
        pkg.scripts = { test: 'node --test' };
        pkg.optionalDependencies = {};

        const result = syncPackage(JSON.stringify(pkg, null, 2), JSON.parse(LOCKFILE), WORKSPACE);

        assert.deepStrictEqual(result.fields, []);
    });

    it('removes what package.json lacks', () => {
        const lockfile = JSON.parse(LOCKFILE);

        lockfile.version = '0.9.0';
        lockfile.packages[''].license = 'MIT';
        lockfile.packages[''].description = 'Stray';

        const result = syncPackage(PACKAGE, lockfile, WORKSPACE);

        assert.deepStrictEqual(result, { fields: ['description', 'license', 'version'], text: LOCKFILE });
    });

    it('rejects a lockfile without a root entry', () => {
        const lockfile = { name: 'fixture-a', version: '1.0.0', lockfileVersion: 1 as const, dependencies: {} };

        assert.throws(() => syncPackage(PACKAGE, lockfile, WORKSPACE), {
            message: 'Lockfile has no root entry: migrate it with `npm i --package-lock-only`'
        });
    });
});

describe('CLI sync-package', () => {
    it('with --dry-run, exits 1 and lists the fields without writing', (t) => {
        const dir = copyFixture(t, WORKSPACE);

        editJson(path.join(dir, 'package.json'), (pkg) => {
            pkg.dependencies.semver = '^7.8.0';
        });

        const result = run(dir, 'sync-package', '--dry-run', '.');

        assert.strictEqual(result.stderr, 'Lockfile out of sync with package.json:\n- dependencies\n');
        assert.strictEqual(result.status, 1);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'), LOCKFILE);
    });

    it('writes what npm writes, after which --dry-run exits 0', (t) => {
        const dir = copyFixture(t, WORKSPACE);

        fs.copyFileSync(path.join(CASES, 'range-bump', 'package.json'), path.join(dir, 'package.json'));

        const result = run(dir, 'sync-package', 'package-lock.json');

        assert.strictEqual(result.stdout, 'Synced lockfile with package.json:\n- dependencies\n');
        assert.strictEqual(result.status, 0);
        assert.strictEqual(
            fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'),
            fs.readFileSync(path.join(CASES, 'range-bump', 'package-lock.json'), 'utf8')
        );

        const again = run(dir, 'sync-package', '--dry-run', '.');

        assert.strictEqual(again.stdout + again.stderr, '');
        assert.strictEqual(again.status, 0);
    });

    it('names a package without a name after its directory and scope', (t) => {
        const dir = path.join(copyFixture(t, WORKSPACE), '@scope', 'no-name');

        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(path.join(WORKSPACE, 'package-lock.json'), path.join(dir, 'package-lock.json'));
        fs.copyFileSync(path.join(CASES, 'no-name', 'package.json'), path.join(dir, 'package.json'));

        const result = run(dir, 'sync-package', '.');

        assert.strictEqual(result.stdout, 'Synced lockfile with package.json:\n- name\n');
        assert.strictEqual(result.status, 0);
        assert.strictEqual(
            fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'),
            fs.readFileSync(path.join(CASES, 'no-name', 'package-lock.json'), 'utf8')
        );
    });
});
