export const USAGE = `gnomon <command>

  validate   check the brain against the schema; nonzero exit on refusals
  index      regenerate principles/_index.md and maps/_index.md if changed
  status     where things stand: unfiled captures, sources, sets, proposals

Run inside a brain: npx gnomon-cli validate`;

const COMMANDS = new Set(['validate', 'index', 'status']);

/** Returns the process exit code. Commands are stubs until spec §13 lands. */
export async function run(argv: string[], out: (s: string) => void = console.log): Promise<number> {
  const cmd = argv[0];
  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    out(USAGE);
    return 0;
  }
  if (!COMMANDS.has(cmd)) {
    out(`gnomon: unknown command '${cmd}'\n\n${USAGE}`);
    return 2;
  }
  out(`gnomon ${cmd}: not implemented yet. Until it is, run tools/gnomon-check.py from the gnomon repo.`);
  return 2;
}
