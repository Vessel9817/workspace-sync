import { program } from 'commander';
import * as file from '../package.json';
import './commands';

program
    .name(file.name)
    .description(file.description)
    .version(file.version);

program.parse(process.argv);
