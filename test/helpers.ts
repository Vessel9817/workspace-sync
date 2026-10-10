import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext } from 'node:test';

export const FIXTURES = path.join(import.meta.dirname, 'fixtures');
export const PROJECT = path.join(FIXTURES, 'project');
const CLI = path.join(import.meta.dirname, '..', 'src', 'cli.ts');

/**
 * Copies a fixture directory to a directory removed after the test
 * @param t The test context
 * @param fixture The fixture directory
 * @returns The copy's path
 */
export function copyFixture(t: TestContext, fixture = PROJECT): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-sync-'));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.cpSync(fixture, dir, { recursive: true });

    return dir;
}

/**
 * Edits a JSON file in place
 * @param file The file path
 * @param edit Changes the parsed JSON
 */
export function editJson(file: string, edit: (json: any) => void): void {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));

    edit(json);
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

/**
 * Runs the CLI from source
 * @param cwd The working directory
 * @param args The CLI arguments
 * @returns The finished process
 */
export function run(cwd: string, ...args: string[]) {
    return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), CLI, ...args], {
        cwd,
        encoding: 'utf8'
    });
}
