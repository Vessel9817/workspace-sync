import { program } from 'commander';
import assert from 'node:assert';
import path from 'node:path';
import { getOrInsert } from '../shims';
import { PATH_ROOT, pathLikeToString, showError } from '../utils';
import { check, Lockfile } from './check';

export async function checkAll(
    baseLockfile: Lockfile
): Promise<void> {
    const workspaces = new Map(baseLockfile.workspaces);
    const errorMsgs = new Array<string>();

    for (const workspace of workspaces.keys()) {
        const rawWorkspaceLockFile = await Lockfile.readFromDir(workspace);

        assert.ok(rawWorkspaceLockFile !== undefined,
            `Couldn't find lockfile in workspace: ${workspace}`);

        Lockfile.validate(rawWorkspaceLockFile[0]);

        const workspaceLockfile = Lockfile.parse(...rawWorkspaceLockFile);

        // Performing map union without disrupting the iterator
        for (const [w, v] of workspaceLockfile.workspaces.entries()) {
            const versions = getOrInsert(workspaces, w, { versions: new Set() });

            versions.versions = versions.versions.union(v.versions);
        }

        try {
            check(baseLockfile, workspaceLockfile);
        }
        catch (err) {
            if (err instanceof Error) {
                const errorMsg = err.message.replaceAll('\n', '\n  ');
                const relWorkspace = path.relative(
                    path.dirname(baseLockfile.path), workspace
                ).replaceAll('\\', '/');

                errorMsgs.push(`- ${relWorkspace}\n  ${errorMsg}`);
            }
            else {
                throw err;
            }
        }
    }

    if (errorMsgs.length > 0) {
        throw new Error(`Workspaces are out of sync:\n${errorMsgs.join('\n')}`);
    }
}

export async function checkAllAction(baseLockfilePath: string): Promise<void> {
    try {
        assert.ok(baseLockfilePath,
            'Missing path to project root directory or lockfile');

        baseLockfilePath = path.resolve(PATH_ROOT, pathLikeToString(baseLockfilePath));

        const [rawLockfile, lockfilePath] = await Lockfile.read(baseLockfilePath);

        Lockfile.validate(rawLockfile);
        await checkAll(Lockfile.parse(rawLockfile, lockfilePath));
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
