// The canonical brain scaffold (schema §2), bundled from template/ at build
// time. Connect-existing offers these files one commit each (spec §7.8,
// §12 step 4); Phase 3's create-from-template commits the whole set.

const files = import.meta.glob('../../../../template/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const rel = (key: string) => key.slice(key.indexOf('/template/') + '/template/'.length);

/** path → text for every markdown file in template/ (AGENTS.md, README.md, templates/*, Set 1, both indexes). */
export const SCAFFOLD: ReadonlyMap<string, string> = new Map(Object.entries(files).map(([k, v]) => [rel(k), v]));
