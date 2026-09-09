// The canonical brain scaffold (schema §2), bundled from template/ at build
// time. Connect-existing offers these files one commit each (spec §7.8,
// §12 step 4); create-from-template commits the whole set at once (spec
// §12 step 3). `exhaustive` admits the dot-files: `.gitignore`, the
// `.gitkeep` keepers, and `.claude/commands/`. A test asserts the key set
// equals the on-disk tree, so the glob cannot silently drift.

const files = import.meta.glob('../../../../template/**/*', { query: '?raw', import: 'default', eager: true, exhaustive: true }) as Record<string, string>;

const rel = (key: string) => key.slice(key.indexOf('/template/') + '/template/'.length);

/** path → text for every file in template/, dot-files included. */
export const SCAFFOLD: ReadonlyMap<string, string> = new Map(Object.entries(files).map(([k, v]) => [rel(k), v]));
