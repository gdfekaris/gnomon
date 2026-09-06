// BrainService — spec §4, §10.2. Owns the snapshot, composes the driver
// stack, and turns every operation into one commit through the driver.
// Framework-free: it writes into plain store objects handed to it, so it
// runs under vitest without Svelte.

import { type BrainSnapshot, type CommitBatch, ValidationError, applyBatch, validateBatch } from '@gnomon/core';
import { HeadMovedError, type StorageDriver, loadSnapshot } from '@gnomon/storage';

export interface SnapshotState {
  current: BrainSnapshot | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
}

export class BrainService {
  private driver: StorageDriver | null = null;

  constructor(private readonly state: SnapshotState) {}

  get connected(): boolean {
    return this.driver !== null;
  }

  /** Point at a driver and load its brain. */
  async connect(driver: StorageDriver): Promise<BrainSnapshot> {
    this.driver = driver;
    this.state.current = null;
    return this.refresh();
  }

  disconnect(): void {
    this.driver = null;
    this.state.current = null;
    this.state.stale = false;
    this.state.error = null;
  }

  /** Reload the snapshot from the driver's head. Clears `stale`. */
  async refresh(): Promise<BrainSnapshot> {
    if (!this.driver) throw new Error('no brain is connected');
    this.state.loading = true;
    this.state.error = null;
    try {
      const s = await loadSnapshot(this.driver);
      this.state.current = s;
      this.state.stale = false;
      return s;
    } catch (e) {
      this.state.error = (e as Error).message;
      throw e;
    } finally {
      this.state.loading = false;
    }
  }

  /**
   * One brain operation, one commit. Refuses a batch that fails the write
   * rules, marks the snapshot stale on HeadMovedError, and on success
   * applies the batch locally at once, then refreshes off the critical path.
   */
  async commit(batch: CommitBatch): Promise<{ sha: string }> {
    if (!this.driver || !this.state.current) throw new Error('no brain is connected');
    const refusals = validateBatch(this.state.current, batch).filter((i) => i.level === 'refusal');
    if (refusals.length) throw new ValidationError(refusals);
    try {
      const result = await this.driver.commit(batch);
      this.state.current = { ...applyBatch(this.state.current, batch), head: result.sha };
      void this.refresh().catch(() => undefined);
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
}
