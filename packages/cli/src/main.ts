#!/usr/bin/env node
// gnomon — the desktop CLI (spec §13). Composes @gnomon/core with a
// working-tree driver; makes no commits.
import { run } from './commands';

const code = await run(process.argv.slice(2));
process.exit(code);
