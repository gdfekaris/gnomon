// Offline capture (spec §14): while offline, Capture accepts text and keeps
// exactly one pending text-only capture in memory, never on device storage
// (§10.3), and saves it when the connection returns. Attachments are not
// queued. Framework-free so it is unit-tested; the store wraps it.

import { describeError } from './errors';
import { NetworkError } from '@gnomon/storage';
import type { BrainService } from './brain';
import { type CaptureInput, type CaptureResult, captureToInbox } from './capture';

export interface PendingState {
  pending: { text: string; note?: string } | null;
  /** the result of the last flush, for the screen to show */
  flushed: CaptureResult | null;
  flushError: string | null;
}

export class OfflineQueue {
  constructor(private readonly state: PendingState, private readonly online: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine)) {}

  get hasPending(): boolean {
    return this.state.pending !== null;
  }

  /**
   * Save now when online; otherwise queue. A text-only capture is queued at
   * most once; an attachment offline is refused; a network failure while
   * nominally online also queues.
   */
  async capture(brain: BrainService, input: CaptureInput): Promise<{ saved: CaptureResult } | { queued: true }> {
    if (!this.online()) return this.queue(input);
    try {
      return { saved: await captureToInbox(brain, input) };
    } catch (e) {
      if (e instanceof NetworkError) return this.queue(input);
      throw e;
    }
  }

  private queue(input: CaptureInput): { queued: true } {
    if (input.attachment) throw new Error('You are offline. Attachments are not queued; save this capture when you are back online.');
    if (this.state.pending) throw new Error('You are offline and one capture is already waiting. It will be saved first when you are back online.');
    if (input.text.trim() === '') throw new Error('a capture needs some text');
    this.state.pending = { text: input.text, ...(input.note ? { note: input.note } : {}) };
    return { queued: true };
  }

  /** Save the pending capture, if any and if online. */
  async flush(brain: BrainService): Promise<CaptureResult | null> {
    const p = this.state.pending;
    if (!p || !this.online() || !brain.connected) return null;
    this.state.flushError = null;
    try {
      const saved = await captureToInbox(brain, p);
      this.state.pending = null;
      this.state.flushed = saved;
      return saved;
    } catch (e) {
      if (e instanceof NetworkError) return null; // still unreachable; keep waiting
      this.state.pending = null;
      this.state.flushError = describeError(e);
      throw e;
    }
  }
}
