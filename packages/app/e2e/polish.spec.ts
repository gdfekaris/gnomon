import { expect, test } from '@playwright/test';
import { FakeGitHub, readBrainBytes, serveGitHub } from './github-fake';

const CAPTURE = '---\ntype: inbox\nstatus: unfiled\ncurated: human\ncreated: 2026-09-09\nupdated: 2026-09-09\n---\nWritten on another device.\n';

test('a fresh brain shows empty states and the nudge on every screen; loading and stale states behave on a slow, shared connection', async ({ page }) => {
  const gh = new FakeGitHub('nobody', 'nothing');
  const bridge = await serveGitHub(page, gh);
  await page.goto('/#/onboarding');
  await page.getByTestId('onboard-create').click();
  await page.getByTestId('onboard-token').fill('test-token');
  await page.getByTestId('onboard-go').click();
  await expect(page.getByTestId('created')).toBeVisible();
  await page.getByTestId('onboard-next').click();
  await page.getByTestId('onboard-next').click();
  await page.getByTestId('onboard-next').click();
  await page.getByTestId('onboard-finish').click();

  const nudge = page.getByTestId('nudge');
  await expect(page.getByRole('heading', { name: 'Capture' })).toBeVisible();
  await expect(nudge).toHaveAttribute('data-kind', 'clear');
  await expect(nudge).toHaveText(/All clear\. Capture something\.$/); // no link to the screen we are on

  await page.goto('/#/browse');
  await expect(nudge).toHaveAttribute('data-kind', 'clear');
  await expect(nudge.getByRole('link', { name: 'Capture' })).toBeVisible();
  await expect(page.getByTestId('set-ps-g8xw')).toContainText('No principles yet');
  await expect(page.getByTestId('sources')).toContainText('No sources yet');
  await expect(page.getByTestId('inbox')).toContainText('Nothing captured yet');
  await expect(page.getByTestId('proposals')).toContainText('No proposals yet');
  await page.goto('/#/sets');
  await expect(page.getByTestId('principles-ps-g8xw')).toContainText('No principles yet');
  await page.goto('/#/reason');
  await expect(page.getByTestId('empty-reason')).toContainText('Nothing to reason from yet');
  await expect(page.getByTestId('send')).toHaveCount(0);
  await page.goto('/#/inbox');
  await expect(page.getByTestId('unfiled')).toContainText('Nothing waiting');
  await expect(page.getByTestId('filings')).toContainText('No filings yet');
  await page.goto('/#/proposals');
  await expect(page.getByText('No proposals yet')).toBeVisible();

  // The first capture moves the nudge to filing, with a link to the Inbox.
  await page.goto('/#/capture');
  await page.getByTestId('capture-text').fill('The first passage.');
  await page.getByTestId('capture-save').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(nudge).toHaveAttribute('data-kind', 'file');
  await expect(nudge).toContainText('1 capture awaits filing.');
  await expect(nudge.getByRole('link', { name: 'File in Inbox' })).toHaveAttribute('href', '#/inbox');

  // A slow connection shows the loading state, named, and then the content.
  bridge.latencyMs = 300;
  await page.goto('/#/browse');
  await page.reload();
  await expect(page.getByTestId('loading')).toHaveText('Loading octocat/brain…');
  await expect(page.getByText('files')).toBeVisible({ timeout: 15_000 });
  bridge.latencyMs = 0;

  // Another device commits: the next write is refused in plain words, the banner offers a refresh, and the retry lands.
  await gh.externalCommit({ 'inbox/20260909-120000-zzz.md': CAPTURE });
  await page.goto('/#/sets');
  await page.getByTestId('new-set').click();
  await expect(page.getByRole('alert')).toContainText('Your repository changed since this screen loaded. Refresh and try again.');
  const banner = page.getByRole('status').filter({ hasText: 'newer changes' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Refresh' }).click();
  await expect(banner).toHaveCount(0);
  await page.getByTestId('new-set').click();
  await expect(page.getByTestId('sets').locator('li.set')).toHaveCount(2);
  await page.goto('/#/capture');
  await expect(nudge).toContainText('2 captures await filing.');
});

test('over the fixture the nudge follows the loop: file, review, decide, all clear', async ({ page }) => {
  // The fixture's own pending filing is not in the demo's history, so it can never be ratified here; leave it out.
  await page.goto('/#/settings?demo-omit=sources/aurelius-meditations-5-1/raw.md,sources/aurelius-meditations-5-1/notes.md,inbox/20260905-143012-x7q.md');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  const nudge = page.getByTestId('nudge');

  await page.goto('/#/capture');
  await expect(nudge).toHaveAttribute('data-kind', 'file');
  await expect(nudge).toContainText('1 capture awaits filing.');
  await nudge.getByRole('link', { name: 'File in Inbox' }).click();
  await page.getByTestId('process').click();
  await expect(page.getByTestId('process-results')).toContainText('filed as unknown-the-only-way-to with 2 proposals');

  await page.goto('/#/capture');
  await expect(nudge).toHaveAttribute('data-kind', 'review');
  await expect(nudge).toContainText('1 filing awaits your review.');
  await nudge.getByRole('link', { name: 'Review in Inbox' }).click();
  const filing = page.getByTestId('filing-unknown-the-only-way-to');
  await filing.getByTestId('review').click();
  await filing.getByTestId('review-panel').getByTestId('ratify').click();
  await expect(filing.getByTestId('state')).toHaveText('ratified');

  await page.goto('/#/browse');
  await expect(nudge).toHaveAttribute('data-kind', 'decide');
  await expect(nudge).toContainText('4 open proposals await a decision.');
  await nudge.getByRole('link', { name: 'Decide in Proposals' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('decline').first().click();
    await expect(page.getByTestId('decline')).toHaveCount(3 - i);
  }

  // Every app commit regenerates the indexes on the way, so the loop ends clear even though the seed's index was stale.
  await page.goto('/#/capture');
  await expect(nudge).toHaveAttribute('data-kind', 'clear');
  await expect(nudge).toHaveText(/All clear\. Capture something\.$/);
});

test('an index left behind by a desktop session is the last nudge, and Settings regenerates it', async ({ page }) => {
  await page.goto('/#/settings?demo-omit=maps/_index.md,inbox/20260906-070000-2bq.md');
  await page.getByTestId('use-demo').click();
  await expect(page.getByText('Connected: demo brain')).toBeVisible();
  const nudge = page.getByTestId('nudge');
  await page.goto('/#/browse');
  // the fixture's pending filing and open proposals come first; the index only once those are quiet
  await expect(nudge).toHaveAttribute('data-kind', 'review');
  await page.goto('/#/settings?demo-omit=maps/_index.md,inbox/20260906-070000-2bq.md,sources/aurelius-meditations-5-1/raw.md,sources/aurelius-meditations-5-1/notes.md,inbox/20260905-143012-x7q.md,maps/proposals/P-20260903-001.md,maps/proposals/P-20260905-001.md,maps/proposals/P-20260905-002.md,maps/proposals/P-20260905-003.md');
  await page.getByTestId('use-demo').click();
  await page.goto('/#/capture');
  await expect(nudge).toHaveAttribute('data-kind', 'index');
  await expect(nudge).toContainText('The index files are behind the brain.');
  await nudge.getByRole('link', { name: 'Regenerate in Settings' }).click();
  await page.getByTestId('offer-indexes').click();
  await expect(page.getByTestId('validation')).toContainText('The brain is valid and its indexes are current.');
  await page.goto('/#/capture');
  await expect(nudge).toHaveAttribute('data-kind', 'clear');
});
