// The app's single BrainService, bound to the snapshot store, plus the two
// ways to connect: the demo brain and a GitHub repository.
import { AuthError, GitHubDriver, NetworkError, NotFoundError, RateLimitError } from '@gnomon/storage';
import { demoDriver } from '../demo/fixture';
import { session } from '../stores/session.svelte';
import { snapshot } from '../stores/snapshot.svelte';
import { type GitSettings, savePrefs } from '../stores/settings.svelte';
import { BrainService } from './brain';

export const brain = new BrainService(snapshot);

/** `omit` drops paths from the demo brain; a test affordance for connect-existing (`#/settings?demo-omit=a,b`). */
export async function connectDemo(omit: string[] = []): Promise<void> {
  const driver = await demoDriver(omit);
  session.driver = driver;
  session.mode = 'demo';
  session.label = 'demo brain';
  await savePrefs({ mode: 'demo' });
  await brain.connect(driver);
}

export async function connectGitHub(git: GitSettings): Promise<void> {
  const driver = new GitHubDriver({ owner: git.owner, name: git.name, token: git.token });
  session.driver = driver;
  session.mode = 'github';
  session.label = `${git.owner}/${git.name}`;
  await savePrefs({ mode: 'github' });
  await brain.connect(driver);
}

export function disconnect(): void {
  brain.disconnect();
  session.driver = null;
  session.mode = null;
  session.label = '';
  void savePrefs({ mode: null });
}

/** A user-facing sentence for a connection failure (spec §14). */
export function describeError(e: unknown): string {
  if (e instanceof AuthError) return 'GitHub rejected the token. Check that it is a fine-grained token with Contents read and write on this repository.';
  if (e instanceof NotFoundError) return 'Repository not found, or the token cannot see it.';
  if (e instanceof RateLimitError) return 'GitHub rate limit reached. Try again in a while.';
  if (e instanceof NetworkError) return 'Could not reach GitHub. Check the connection.';
  return (e as Error).message;
}
