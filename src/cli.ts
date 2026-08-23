#!/usr/bin/env node

import { program } from 'commander';
import * as file from '../package.json' with { type: 'json' };
import './commands';

program
    .name(file.name)
    .description(file.description)
    .version(file.version)
    .parse(process.argv);
