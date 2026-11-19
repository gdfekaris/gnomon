// BrainService — spec §4, §10.2. Owns the snapshot, composes the driver
// stack, and turns every operation into one commit through the driver.
// Framework-free: it writes into plain store objects handed to it, so it
// runs under vitest without Svelte.

import { type BrainSnapshot, type CommitBatch, ValidationError, applyBatch, validateBatch } from '@gnomon/core';
import { HeadMovedError, NetworkError, type StorageDriver, loadSnapshot } from '@gnomon/storage';
import { describeError } from './errors';
import type { CaptureSealer } from './sealing';

export interface SnapshotState {
  current: BrainSnapshot | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  /** what is shown was opened from the copy on this device and has not been checked against the repository since (spec §6.6) */
  fromCopy?: boolean;
  timings?: Timings;
}

/** How long the last load and the last commit took, for Settings → About (spec §6.6). */
export interface Timings { open: { ms: number; from: 'copy' | 'repository' } | null; refreshMs: number | null; commitMs: number | null }
const clock = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

export class BrainService {
  private driver: StorageDriver | null = null;
  /** the same stack reading only the copy on this device; null when there is none (the demo brain) */
  private local: StorageDriver | null = null;
  /** counts loads started and commits landed: a load applies only when nothing has happened since it began */
  private seq = 0;
  private loads = 0;
  private time(patch: Partial<Timings>): void {
    this.state.timings = { open: null, refreshMs: null, commitMs: null, ...this.state.timings, ...patch };
  }
  private readonly loaded: Array<(s: BrainSnapshot) => void> = [];
  /** Adds this device's seal to a capture batch when sealing is on (spec §6.5); none when it is not. */
  captureSealer: CaptureSealer | null = null;

  constructor(private readonly state: SnapshotState) {}

  get connected(): boolean {
    return this.driver !== null;
  }

  /**
   * Point at a driver and load its brain. With `local` and `fromCopy`, the
   * brain opens from the copy on this device with no request at all; the
   * caller then checks the repository with `refresh`.
   */
  async connect(driver: StorageDriver, opts: { local?: StorageDriver | null; fromCopy?: boolean } = {}): Promise<BrainSnapshot> {
    this.driver = driver;
    this.local = opts.local ?? null;
    this.state.current = null;
    this.state.fromCopy = false;
    const started = clock();
    if (!(opts.fromCopy && this.local)) {
      const s = await this.refresh();
      this.time({ open: { ms: Math.round(clock() - started), from: 'repository' } });
      return s;
    }
    const mine = ++this.seq;
    let s: BrainSnapshot;
    try {
      s = await loadSnapshot(this.local);
    } catch (e) {
      // A locked brain says so, as a load from the repository would; a copy that cannot answer is the caller's cue to ask the repository.
      if (mine === this.seq && !(e instanceof NetworkError)) this.state.error = describeError(e);
      throw e;
    }
    if (mine === this.seq) {
      this.state.current = s;
      this.state.stale = false;
      this.state.error = null;
      this.state.fromCopy = true;
      for (const fn of this.loaded) fn(s);
    }
    this.time({ open: { ms: Math.round(clock() - started), from: 'copy' } });
    return s;
  }

  disconnect(): void {
    this.driver = null;
    this.local = null;
    this.seq++;
    this.state.current = null;
    this.state.stale = false;
    this.state.error = null;
    this.state.fromCopy = false;
  }

  /** Swap the driver stack under a live session (encryption turned on or off) and reload through the new one. */
  async replaceDriver(driver: StorageDriver, local: StorageDriver | null = null): Promise<BrainSnapshot> {
    this.driver = driver;
    this.local = local;
    return this.refresh();
  }

  /**
   * Load the brain again after it was dropped from memory (unlocking): from
   * the copy on this device when it can answer, which needs no connection,
   * else from the repository. The caller checks the repository afterwards.
   */
  async reopen(): Promise<BrainSnapshot> {
    if (!this.driver) throw new Error('no brain is connected');
    if (this.local) {
      const mine = ++this.seq;
      try {
        const s = await loadSnapshot(this.local);
        if (mine === this.seq) {
          this.state.current = s;
          this.state.stale = false;
          this.state.error = null;
          this.state.fromCopy = true;
          for (const fn of this.loaded) fn(s);
        }
        return s;
      } catch {
        // the copy could not answer; ask the repository
      }
    }
    return this.refresh();
  }

  /** Drop the loaded brain from memory while keeping the connection: what locking an encrypted brain means for this process. */
  clearSnapshot(error: string | null = null): void {
    this.seq++;
    this.state.current = null;
    this.state.stale = false;
    this.state.error = error;
    this.state.fromCopy = false;
  }

  /**
   * Commit a batch whose writes are stored bytes rather than brain files (the
   * encrypt, decrypt, and rekey plans of spec §6.4) through the driver given,
   * which is the plain one under the encrypting wrapper. Nothing is applied
   * locally: the caller swaps the stack and refreshes. A moved head marks the
   * snapshot stale as an ordinary commit would.
   */
  async commitStored(batch: CommitBatch, via: StorageDriver): Promise<{ sha: string }> {
    if (!this.state.current) throw new Error('no brain is connected');
    try {
      return await via.commit(batch);
    } catch (e) {
      if (e instanceof HeadMovedError) this.state.stale = true;
      throw e;
    }
  }

  /** Run `fn` after every load of a snapshot from the driver (verification, spec §6.5). */
  onLoad(fn: (s: BrainSnapshot) => void): void {
    this.loaded.push(fn);
  }

  /**
   * Reload the snapshot from the driver's head. Clears `stale`. A load that
   * a commit or a newer load overtook is dropped, so a slow answer never
   * replaces a newer brain. With a brain already open, an unreachable
   * repository is not an error on screen: the open brain stays.
   */
  async refresh(): Promise<BrainSnapshot> {
    if (!this.driver) throw new Error('no brain is connected');
    const driver = this.driver;
    const mine = ++this.seq;
    const started = clock();
    this.loads++;
    this.state.loading = true;
    if (!this.state.current) this.state.error = null;
    try {
      const s = await loadSnapshot(driver);
      if (mine !== this.seq || driver !== this.driver) return this.state.current ?? s;
      this.state.current = s;
      this.state.stale = false;
      this.state.error = null;
      this.state.fromCopy = false;
      this.time({ refreshMs: Math.round(clock() - started) });
      for (const fn of this.loaded) fn(s);
      return s;
    } catch (e) {
      if (mine === this.seq && !(e instanceof NetworkError && this.state.current)) this.state.error = describeError(e);
      throw e;
    } finally {
      if (--this.loads === 0) this.state.loading = false;
    }
  }

  /**
   * After an own commit the copy on this device is already at the new head
   * (the caching driver advanced it from the batch), so the reload that
   * gives every file its stored form asks the repository nothing. Anything
   * unexpected falls back to a real refresh.
   */
  private async reloadFromCopy(sha: string): Promise<void> {
    const local = this.local;
    const mine = this.seq;
    try {
      if (!local) throw new Error('no copy');
      const s = await loadSnapshot(local);
      if (mine !== this.seq) return;
      if (s.head !== sha) throw new Error('the copy is not at the commit');
      this.state.current = s;
      for (const fn of this.loaded) fn(s);
    } catch {
      if (mine === this.seq) void this.refresh().catch(() => undefined);
    }
  }

  /**
   * One brain operation, one commit. Refuses a batch that fails the write
   * rules, marks the snapshot stale on HeadMovedError, and on success
   * applies the batch locally at once, then reloads off the critical path:
   * from the copy on this device when there is one, from the repository
   * otherwise.
   */
  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    if (!this.driver || !this.state.current) throw new Error('no brain is connected');
    const refusals = validateBatch(this.state.current, batch).filter((i) => i.level === 'refusal');
    if (refusals.length) throw new ValidationError(refusals);
    const started = clock();
    try {
      const result = await this.driver.commit(batch);
      this.seq++;
      this.state.current = { ...applyBatch(this.state.current, batch), head: result.sha };
      this.state.stale = false;
      this.state.fromCopy = false;
      this.time({ commitMs: Math.round(clock() - started) });
      void this.reloadFromCopy(result.sha);
      return result;
    } catch (e) {
      if (e instanceof HeadMovedError) this.state.stale = true;
      throw e;
    }
  }

  /** The head this service will pass as expectedHead. */
  get head(): string | null {
    return this.state.current?.head ?? null;
  }

  get snapshot(): BrainSnapshot | null {
    return this.state.current;
  }
}
