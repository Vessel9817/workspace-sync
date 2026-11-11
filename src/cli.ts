#!/usr/bin/env node

import { program } from 'commander';
import file from '../package.json' with { type: 'json' };
import { checkAction, checkAllAction, syncPackageAction } from './commands';

program
    .command('check')
    .description('Check workspace lockfile sync')
    .argument('<base_lockfile>', 'Path to the project root directory or lockfile')
    .argument('<workspace_lockfile>', 'Path to the workspace directory or lockfile')
    .action(checkAction);

program
    .command('check-all')
    .description('Check workspace lockfile sync across all workspaces')
    .argument('<base_lockfile>', 'Path to the project root directory or lockfile')
    .action(checkAllAction);

program
    .command('sync-package')
    .description('Sync a lockfile with its package.json, as npm does')
    .argument('<base_lockfile>', 'Path to the project root directory or lockfile')
    .option('--dry-run', 'Report differences without writing them to the lockfile')
    .action(syncPackageAction);

program
    .name(file.name)
    .description(file.description)
    .version(file.version)
    .parse(process.argv);
