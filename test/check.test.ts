import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { check, checkAll, Lockfile } from '../src/commands';
import { copyFixture, editJson, PROJECT, run } from './helpers';

const WORKSPACE = path.join(PROJECT, 'packages', 'a');

/**
 * Reads, edits, validates and parses a lockfile
 * @param lockfilePath Path to the lockfile or its directory
 * @param edit Changes the raw lockfile before it's validated
 * @returns The parsed lockfile
 */
async function load(
    lockfilePath: string,
    edit?: (lockfile: any) => void
): Promise<Lockfile> {
    const [lockfile, resolvedPath] = await Lockfile.read(lockfilePath);

    edit?.(lockfile);
    Lockfile.validate(lockfile);

    return Lockfile.parse(lockfile, resolvedPath);
}

/**
 * Pins a semver version the root lockfile lacks
 * @param lockfile The raw workspace lockfile
 */
function pinOldSemver(lockfile: any): void {
    lockfile.packages['node_modules/semver'].version = '7.7.4';
}

describe('Lockfile', () => {
    it('reads a lockfile from its directory or its path', async () => {
        const [fromDir, lockfilePath] = await Lockfile.read(PROJECT);
        const [fromFile] = await Lockfile.read(lockfilePath);

        assert.strictEqual(lockfilePath, path.join(PROJECT, 'package-lock.json'));
        assert.deepStrictEqual(fromFile, fromDir);
    });

    it('collects packages and workspaces', async () => {
        const root = await load(PROJECT);

        assert.deepStrictEqual([...root.packages.keys()].sort(), ['ms', 'semver', 'tslib']);
        assert.deepStrictEqual(root.packages.get('semver')?.versions, new Set(['7.8.5']));
        assert.deepStrictEqual(root.workspaces.get(WORKSPACE)?.versions, new Set(['1.0.0']));
    });

    it('rejects an unsupported lockfile version', async () => {
        await assert.rejects(load(PROJECT, (lockfile) => {
            lockfile.lockfileVersion = 4;
        }), { message: 'Unsupported lockfile version: 4' });
    });

    it('rejects legacy dependencies in a v3 lockfile', async () => {
        await assert.rejects(load(PROJECT, (lockfile) => {
            lockfile.dependencies = {};
        }), { message: 'Invalid lockfile: dependencies should be migrated to packages' });
    });
});

describe('check', () => {
    it('passes when each workspace lockfile is in sync', async () => {
        const root = await load(PROJECT);

        check(root, await load(WORKSPACE));
        check(root, await load(path.join(PROJECT, 'packages', 'b')));
    });

    it('passes on v2 lockfiles', async () => {
        const v2 = (lockfile: any) => {
            lockfile.lockfileVersion = 2;
        };

        check(await load(PROJECT, v2), await load(WORKSPACE, v2));
    });

    it('fails when the workspace pins a version the root lacks', async () => {
        const root = await load(PROJECT);
        const workspace = await load(WORKSPACE, pinOldSemver);

        assert.throws(() => check(root, workspace), {
            message: 'Packages missing from project root lockfile:\n- semver@7.7.4'
        });
    });

    it('fails when the root has another version of the workspace', async () => {
        const root = await load(PROJECT);
        const workspace = await load(WORKSPACE, (lockfile) => {
            lockfile.version = '1.1.0';
        });

        assert.throws(() => check(root, workspace), {
            message: 'Base lockfile out of date: expected workspace version 1.1.0'
        });
    });
});

describe('checkAll', () => {
    it('passes when every workspace is in sync', async () => {
        await checkAll(await load(PROJECT));
    });

    it('lists each workspace that is out of sync', async (t) => {
        const project = copyFixture(t);

        editJson(path.join(project, 'packages', 'a', 'package-lock.json'), pinOldSemver);

        await assert.rejects(checkAll(await load(project)), {
            message: 'Workspaces are out of sync:\n- packages/a\n'
                + '  Packages missing from project root lockfile:\n  - semver@7.7.4'
        });
    });

    it('fails when a workspace has no lockfile', async (t) => {
        const project = copyFixture(t);
        const workspace = path.join(project, 'packages', 'b');

        fs.rmSync(path.join(workspace, 'package-lock.json'));

        await assert.rejects(checkAll(await load(project)), {
            message: `Couldn't find lockfile in workspace: ${workspace}`
        });
    });
});

describe('CLI', () => {
    it('exits 0 when in sync', () => {
        const result = run(PROJECT, 'check', '.', 'packages/a');

        assert.strictEqual(result.stderr, '');
        assert.strictEqual(result.status, 0);
    });

    it('exits 1 and prints the problems when out of sync', (t) => {
        const project = copyFixture(t);

        editJson(path.join(project, 'packages', 'a', 'package-lock.json'), pinOldSemver);

        const result = run(project, 'check-all', '.');

        assert.match(result.stderr, /^Workspaces are out of sync:\n- packages\/a\n/);
        assert.strictEqual(result.status, 1);
    });
});
