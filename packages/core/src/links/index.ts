// links — spec §7.1. Seeded in block 4 with the one function validation
// needs; parseLinks, renderDualLink, backlinks, and groundsDrift land in block 6.

const SOURCE_LINK = /\[\[sources\/([a-z0-9-]+)\/raw(?:#[^\]]*)?\]\]/g;

/** Source slugs a body links to via `[[sources/<slug>/raw]]` wikilinks, in order of first reference, deduplicated. */
export function linkedSourceSlugs(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(SOURCE_LINK)) {
    const slug = m[1]!;
    if (!out.includes(slug)) out.push(slug);
  }
  return out;
}
