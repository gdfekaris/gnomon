// The demo brain: the reference fixture (spec §6.3, §17) bundled into the
// app and served through a MemoryDriver. Markdown is inlined at build time;
// the attachments come through `?url`, which Vite resolves to a static
// asset in dev and, for a small file in a production build, to a `data:`
// URL. The CSP's connect-src has no `data:`, so a fetch of that URL fails
// (Safari says "Load failed"); data URLs are decoded here instead.

import { type BrainFile, type NotesFm, type PrincipleFm, type SourceFm, RESERVE_SLUG, fromBase64, indexWrites, serializeFile } from '@gnomon/core';
import { MemoryDriver, loadSnapshot } from '@gnomon/storage';

const texts = import.meta.glob('../../../../core/fixtures/brain/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const binaries = import.meta.glob('../../../../core/fixtures/brain/**/*.pdf', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

const rel = (key: string) => key.slice(key.indexOf('/fixtures/brain/') + '/fixtures/brain/'.length);

export async function demoDriver(omit: string[] = [], fill = 0, reserveFill = 0): Promise<MemoryDriver> {
  const seed = new Map<string, string | Uint8Array>();
  for (const [key, text] of Object.entries(texts)) seed.set(rel(key), text);
  for (const [key, url] of Object.entries(binaries)) seed.set(rel(key), await bytesOf(url));
  for (const p of omit) seed.delete(p);
  if (fill > 0 || reserveFill > 0) {
    if (fill > 0) fillSources(seed, fill);
    if (reserveFill > 0) fillReserve(seed, reserveFill);
    // The filled brain regenerates its indexes so it is as consistent as a real one.
    const snap = await loadSnapshot(await MemoryDriver.create(seed, {}, 'Initial commit'));
    for (const w of indexWrites(snap)) if ('text' in w) seed.set(w.path, w.text);
  }
  return MemoryDriver.create(seed, {}, 'Initial commit');
}

// `#/settings?demo-fill=n` (a test affordance, like `demo-omit`): n rounds of four generated sources, spread
// over twelve authors, two works each, twelve months, and thirty tags, so a flow can browse hundreds.
const AUTHORS = ['Émile Zola', 'Marcus Aurelius', 'Joan Didion', 'Simone Weil', 'Seneca', 'Michel de Montaigne', 'Virginia Woolf', 'James Baldwin', 'Hannah Arendt', 'Epictetus', 'Annie Dillard', 'George Orwell'];
const WORKS: Record<string, [string, number][]> = {
  'Émile Zola': [['J’accuse', 1898], ['Germinal', 1885]], 'Marcus Aurelius': [['Meditations', 180], ['Letters', 175]], 'Joan Didion': [['Why I Write', 1976], ['The White Album', 1979]],
  'Simone Weil': [['Gravity and Grace', 1947], ['Waiting for God', 1950]], Seneca: [['Letters to Lucilius', 65], ['On the Shortness of Life', 49]], 'Michel de Montaigne': [['Essays', 1580], ['Travel Journal', 1581]],
  'Virginia Woolf': [['A Room of One’s Own', 1929], ['The Waves', 1931]], 'James Baldwin': [['Notes of a Native Son', 1955], ['The Fire Next Time', 1963]], 'Hannah Arendt': [['The Human Condition', 1958], ['Eichmann in Jerusalem', 1963]],
  Epictetus: [['Enchiridion', 125], ['Discourses', 108]], 'Annie Dillard': [['The Writing Life', 1989], ['Pilgrim at Tinker Creek', 1974]], 'George Orwell': [['Politics and the English Language', 1946], ['Why I Write', 1946]],
};
const TAGS = ['stoicism', 'writing', 'attention', 'work', 'solitude', 'thinking', 'courage', 'craft', 'time', 'death', 'friendship', 'money', 'habit', 'reading', 'memory', 'grief', 'anger', 'patience', 'truth', 'power', 'freedom', 'nature', 'travel', 'love', 'silence', 'discipline', 'humor', 'fear', 'justice', 'rest'];
function fillSources(seed: Map<string, string | Uint8Array>, fill: number): void {
  for (let k = 0; k < fill * 4; k++) {
    const author = AUTHORS[k % AUTHORS.length]!;
    const [work, year] = WORKS[author]![Math.floor(k / AUTHORS.length) % 2]!;
    const month = String(1 + (k % 12)).padStart(2, '0');
    const day = String(1 + (k % 27)).padStart(2, '0');
    const created = `${k % 24 < 12 ? 2025 : 2026}-${month}-${day}T${String(k % 24).padStart(2, '0')}:00:00Z`;
    const slug = `${author.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${k + 1}`;
    const tags = [...new Set([TAGS[k % TAGS.length]!, TAGS[(k * 7 + 3) % TAGS.length]!])];
    const raw: BrainFile<SourceFm> = { path: `sources/${slug}/raw.md`, sha: '', encrypted: false, body: `Filled passage ${k + 1}, from ${work}.\n`, fm: { type: 'source', title: `Passage ${k + 1} of ${work}`, author, work, year, tags, curated: 'ratified', created, updated: created } };
    const notes: BrainFile<NotesFm> = { path: `sources/${slug}/notes.md`, sha: '', encrypted: false, body: '', fm: { type: 'notes', source: slug, curated: 'ratified', created, updated: created } };
    seed.set(raw.path, serializeFile(raw));
    seed.set(notes.path, serializeFile(notes));
  }
}

// `#/settings?reserve-fill=n`: n generated principles in the reserve (schema §7.14), titles starting with
// different letters for the A–Z sort, created dates rising with n for newest-first, two tags each from the
// list above, and one of the fixture's sources as a ground, so a flow can search and page a reserve of hundreds.
const WORDS = ['Attend', 'Begin', 'Choose', 'Doubt', 'Endure', 'Finish', 'Give', 'Hold', 'Insist', 'Judge', 'Keep', 'Listen', 'Mend', 'Notice', 'Own', 'Pause', 'Question', 'Rest', 'Say', 'Try', 'Undo', 'Value', 'Wait', 'Yield'];
const GROUNDS = ['aurelius-meditations-4-3', 'didion-why-i-write', 'weil-attention'];
function fillReserve(seed: Map<string, string | Uint8Array>, n: number): void {
  for (let k = 0; k < n; k++) {
    const title = `${WORDS[k % WORDS.length]!} ${k + 1}`;
    const slug = `${WORDS[k % WORDS.length]!.toLowerCase()}-${k + 1}`;
    const ground = GROUNDS[k % GROUNDS.length]!;
    const tags = [...new Set([TAGS[k % TAGS.length]!, TAGS[(k * 7 + 3) % TAGS.length]!])];
    // one hour apart, after every fixture date, so newest first is the last generated
    const created = new Date(Date.UTC(2027, 0, 1) + k * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const p: BrainFile<PrincipleFm> = {
      path: `principles/${RESERVE_SLUG}/${slug}.md`, sha: '', encrypted: false,
      body: `Filled reserve principle ${k + 1}.\n\n- [[sources/${ground}/raw]] ([raw](../../sources/${ground}/raw.md))\n`,
      fm: { type: 'principle', title, set: RESERVE_SLUG, grounds: [ground], tags, curated: 'human', created, updated: created },
    };
    seed.set(p.path, serializeFile(p));
  }
}

async function bytesOf(url: string): Promise<Uint8Array> {
  const inline = /^data:[^,]*;base64,(.*)$/.exec(url);
  if (inline) return fromBase64(inline[1]!);
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}
