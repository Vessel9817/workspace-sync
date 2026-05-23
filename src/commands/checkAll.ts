import { program } from 'commander';
import assert from 'node:assert';
import path from 'node:path';
import { PATH_ROOT, pathLikeToString, showError } from '../utils';
import { check, Lockfile, parseLockfile, readLockfile, readLockfileFromDir } from './check';

export async function checkAll(
    baseLockfile: Lockfile
): Promise<void> {
    const workspaces = new Set(baseLockfile.workspaces);

    for (const workspace of workspaces) {
        const rawWorkspaceLockFile = await readLockfileFromDir(workspace);

        assert.ok(rawWorkspaceLockFile != null,
            `Couldn't find lockfile in workspace: ${workspace}`);

        const workspaceLockfile = parseLockfile(...rawWorkspaceLockFile);

        // Performing set union without disrupting the iterator
        for (const w of workspaceLockfile.workspaces) {
            workspaces.add(w);
        }

        // TODO Add better error handling to display the diffs of all lockfiles
        check(baseLockfile, workspaceLockfile);
    }
}

export async function checkAllAction(baseLockfilePath: string): Promise<void> {
    try {
        assert.ok(baseLockfilePath,
            'Missing path to project root directory or lockfile');

        baseLockfilePath = path.resolve(PATH_ROOT, pathLikeToString(baseLockfilePath));

        const lockfile = parseLockfile(...await readLockfile(baseLockfilePath));

        await checkAll(lockfile);
    }
    catch (err) {
        showError(err);
    }
}

program
    .command('check-all')
    .description('Check workspace lockfile sync across all workspaces')
    .argument('<base_lockfile>', 'Path to the project root directory or lockfile')
    .action(checkAllAction);
