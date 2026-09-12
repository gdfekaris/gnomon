import { expect, test } from '@playwright/test';
import { FakeGitHub, readBrainBytes, serveGitHub } from './github-fake';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
});

test('write a principle from the editor with a grounding link from the picker', async ({ page }) => {
  await page.goto('/#/sets');
  await page.getByTestId('set-ps-7k2m').getByTestId('new-principle').click();
  await expect(page.getByRole('heading', { name: 'New principle in Set 2 — Work' })).toBeVisible();
  await page.getByTestId('edit-title').fill('Rise to the work');
  await page.getByTestId('edit-body').fill('Get up; the work is what you are for.');
  await page.getByTestId('link-picker').selectOption('aurelius-meditations-5-1');
  await page.getByTestId('link-insert').click();
  await expect(page.getByTestId('ground-aurelius-meditations-5-1')).toBeVisible();
  await expect(page.getByTestId('edit-body')).toHaveValue(/\[\[sources\/aurelius-meditations-5-1\/raw\]\] \(\[raw\]\(\.\.\/\.\.\/sources\/aurelius-meditations-5-1\/raw\.md\)\)/);
  await expect(page.getByTestId('drift')).toHaveCount(0);
  await page.getByTestId('edit-tags').fill('Stoicism, work');
  await page.getByTestId('edit-save').click();

  await expect(page).toHaveURL(/#\/browse\/principles\/ps-7k2m\/rise-to-the-work\.md$/);
  await expect(page.getByRole('heading', { name: 'Rise to the work' })).toBeVisible();
  await expect(page.getByTestId('frontmatter')).toContainText('3');
  await expect(page.getByTestId('file-body').locator('a')).toHaveCount(1);
  await expect(page.getByTestId('backlinks')).toHaveCount(1);
  await page.goto('/#/settings');
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
});

test('grounds drift is flagged and synced in either direction', async ({ page }) => {
  await page.goto('/#/edit/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByRole('heading', { name: 'Edit principle' })).toBeVisible();
  await expect(page.getByTestId('drift')).toHaveCount(0);
  // grounds only: remove the link from the body
  const body = await page.getByTestId('edit-body').inputValue();
  await page.getByTestId('edit-body').fill(body.split('**Grounding passages:**')[0]!.trim());
  await expect(page.getByTestId('drift')).toContainText('In grounds only: aurelius-meditations-4-3');
  await page.getByTestId('sync-body').click();
  await expect(page.getByTestId('drift')).toHaveCount(0);
  await expect(page.getByTestId('edit-body')).toHaveValue(/\[\[sources\/aurelius-meditations-4-3\/raw\]\]/);
  // body only: remove the chip
  await page.getByTestId('ground-aurelius-meditations-4-3').getByRole('button').click();
  await expect(page.getByTestId('drift')).toContainText('Linked in the body only: aurelius-meditations-4-3');
  await page.getByTestId('sync-grounds').click();
  await expect(page.getByTestId('drift')).toHaveCount(0);
  await expect(page.getByTestId('ground-aurelius-meditations-4-3')).toBeVisible();
  await page.getByTestId('edit-save').click();
  await expect(page).toHaveURL(/courage-before-comfort\.md$/);
  await page.goto('/#/settings');
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
});

test('editing notes makes them human; source metadata edits keep the passage read-only', async ({ page }) => {
  await page.goto('/#/browse/sources/aurelius-meditations-5-1/notes.md');
  await expect(page.getByTestId('fm-curated')).toHaveText('awaiting review');
  await page.getByTestId('edit-link').click();
  await page.getByTestId('edit-body').fill('Compare the morning passage with 4.3.');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await expect(page.getByTestId('file-body')).toContainText('Compare the morning passage with 4.3.');

  await page.goto('/#/browse/sources/didion-why-i-write/raw.md');
  await expect(page.getByText('the passage text is immutable')).toBeVisible();
  await page.getByTestId('edit-link').click();
  await expect(page.getByTestId('passage-readonly')).toContainText("I write entirely to find out what I'm thinking");
  await expect(page.getByTestId('edit-body')).toHaveCount(0);
  await page.getByTestId('edit-title').fill('Why I write');
  await page.getByTestId('edit-year').fill('1976');
  await page.getByTestId('edit-save').click();
  await expect(page.getByRole('heading', { name: 'Why I write' })).toBeVisible();
  await expect(page.getByTestId('fm-curated')).toHaveText('yours');
  await expect(page.getByTestId('file-body')).toContainText("I write entirely to find out what I'm thinking");

  await page.goto('/#/edit/sources/didion-why-i-write/original.pdf');
  await expect(page.getByText('Nothing editable at')).toBeVisible();
});

// A principle changes set by being copied there and the original deleted:
// two commits, no file moved (schema §1 rule 1). The editor offers the copy,
// pre-fills the new principle, then asks about the original with the
// dangling-reference report.
test('copy a principle to another set, then delete the original', async ({ page }) => {
  await page.goto('/#/edit/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByTestId('edit-title')).toHaveValue('Courage before comfort');
  await page.getByTestId('copy-set').selectOption('ps-7k2m');
  await page.getByTestId('copy-go').click();
  await expect(page.getByRole('heading', { name: 'New principle in Set 2 — Work' })).toBeVisible();
  await expect(page.getByTestId('from-copy')).toContainText('Copied from Courage before comfort');
  await expect(page.getByTestId('edit-title')).toHaveValue('Courage before comfort');
  await expect(page.getByTestId('edit-body')).not.toHaveValue('');
  await page.getByTestId('edit-save').click();

  // Back on the original, with the copy named and the question asked.
  await expect(page).toHaveURL(/#\/edit\/principles\/ps-g8xw\/courage-before-comfort\.md\?copied=principles%2Fps-7k2m%2Fcourage-before-comfort\.md$/);
  await expect(page.getByTestId('copied')).toContainText('The copy is in place');
  await page.getByTestId('delete-original').click();
  await expect(page.getByTestId('copied')).toContainText('Delete the original');
  await page.getByTestId('delete-original-yes').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-7k2m\/courage-before-comfort\.md$/);

  await page.goto('/#/sets');
  await expect(page.getByTestId('set-ps-g8xw')).not.toContainText('Courage before comfort');
  const work = page.getByTestId('set-ps-7k2m');
  await expect(work).toContainText('Courage before comfort');
  await expect(work.locator('li').last()).toContainText('Courage before comfort');
  await page.goto('/#/settings');
  await expect(page.getByTestId('refusal-count')).toHaveText('0 refusals');
});

test('with one set, the editor says how to get a copy control instead of hiding it', async ({ page }) => {
  // Drop Set 2 from the demo brain: only Set 1 remains.
  await page.goto('/#/settings?demo-omit=principles/ps-7k2m/_set.md,principles/ps-7k2m/say-the-hard-thing-first.md,principles/ps-7k2m/write-to-find-out.md');
  await page.getByTestId('use-demo').click();
  await page.goto('/#/edit/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByTestId('copy-to')).toHaveCount(0);
  await expect(page.getByTestId('copy-needs-set')).toContainText('create that set first');
});

// The maintainer's phone: the app relaunched into the editor's URL and the proposal's draft was gone. The
// fields must load once the brain is here, not once at mount, whether the route is reached by a tap or a
// cold start.
test('a proposal draft survives a cold start into the editor route', async ({ page }) => {
  await page.goto('/#/sets/ps-7k2m/new-principle?from=P-20260905-001');
  await expect(page.getByTestId('edit-title')).toHaveValue('Rise to the work');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New principle in Set 2 — Work' })).toBeVisible();
  await expect(page.getByTestId('edit-title')).toHaveValue('Rise to the work');
  await expect(page.getByTestId('edit-body')).toHaveValue(/Written from \[\[maps\/proposals\/P-20260905-001\]\]/);
  await expect(page.getByTestId('ground-aurelius-meditations-5-1')).toBeVisible();
});

test('Back leaves an untouched editor at once and asks first when there are unsaved changes', async ({ page }) => {
  await page.goto('/#/edit/principles/ps-g8xw/courage-before-comfort.md');
  await expect(page.getByTestId('edit-title')).toHaveValue('Courage before comfort');
  await page.getByTestId('edit-back').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/courage-before-comfort\.md$/);

  await page.getByTestId('edit-link').click();
  await page.getByTestId('edit-title').fill('Courage before comfort, always');
  await page.getByTestId('edit-back').click();
  await expect(page.getByTestId('discard-confirm')).toContainText('changes that are not saved');
  await expect(page).toHaveURL(/#\/edit\/principles\/ps-g8xw\/courage-before-comfort\.md$/);
  await page.getByTestId('discard-no').click();
  await expect(page.getByTestId('discard-confirm')).toHaveCount(0);
  await expect(page.getByTestId('edit-title')).toHaveValue('Courage before comfort, always');
  await page.getByTestId('edit-back').click();
  await page.getByTestId('discard-yes').click();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-g8xw\/courage-before-comfort\.md$/);
  await expect(page.getByRole('heading', { name: 'Courage before comfort', exact: true })).toBeVisible();
});

// A commit to GitHub takes seconds; the button says so while it happens (over the fake, slowed down).
test('the save button reports progress while the commit is in flight', async ({ page }) => {
  const gh = await FakeGitHub.create(readBrainBytes());
  const bridge = await serveGitHub(page, gh);
  await page.goto('/#/settings');
  await page.getByTestId('git-owner').fill('octocat');
  await page.getByTestId('git-name').fill('brain');
  await page.getByTestId('git-token').fill('test-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Connected: octocat/brain')).toBeVisible();
  await page.goto('/#/sets/ps-7k2m/new-principle');
  await expect(page.getByRole('heading', { name: 'New principle in Set 2 — Work' })).toBeVisible();
  await page.getByTestId('edit-title').fill('Finish what you start');
  bridge.latencyMs = 150;
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('edit-save')).toHaveText('Adding…');
  await expect(page.getByTestId('edit-save')).toHaveAttribute('aria-busy', 'true'); // drawn pressed until the commit lands
  await expect(page.getByTestId('saving')).toBeVisible();
  await expect(page).toHaveURL(/#\/browse\/principles\/ps-7k2m\/finish-what-you-start\.md$/, { timeout: 15_000 });
  expect([...gh.commits.values()].map((c) => c.message)).toContain('Add principle: Finish what you start');
});
