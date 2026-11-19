// The capture queue (spec §14): a capture that cannot be saved now, because
// the device is offline, the repository cannot be reached, or the brain is
// not connected yet, waits on this device and is saved, in order, when it
// can be. The queue is kept in device storage (spec §10.3), so it survives
// the app being closed. Each capture keeps the time it was made. Nothing is
// ever dropped: one that fails for a reason other than the network stays in
// the queue with its reason until the curator retries, takes it back into
// the form, or discards it. Attachments are not queued. Framework-free so it
// is unit-tested; the store wraps it.

import { nowUtc } from '@gnomon/core';
import { NetworkError } from '@gnomon/storage';
import { describeError } from './errors';
import type { BrainService } from './brain';
import { type CaptureInput, type CaptureResult, captureToInbox } from './capture';

export interface QueuedCapture {
  id: string;
  text: string;
  note?: string;
  /** when it was captured; the saved capture carries this time, not the time it was sent */
  at: string;
  /** why the last attempt to save it failed, when that was not the network */
  error?: string;
}

export interface PendingState {
  queue: QueuedCapture[];
  /** the result of the last flush, for the screen to show */
  flushed: CaptureResult | null;
}

/** Where the queue is kept between launches. Synchronous, so a capture is on the device before the tap returns. */
export interface QueueStore {
  load(): QueuedCapture[];
  save(queue: QueuedCapture[]): void;
}

export const QUEUE_KEY = 'gnomon.capture.queue';
export const DRAFT_KEY = 'gnomon.capture.draft';

/** localStorage: small, synchronous, and the storage iOS has kept when IndexedDB did not (see persist.ts). */
export function localQueueStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): QueueStore {
  return {
    load() {
      try {
        const raw = storage?.getItem(QUEUE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as QueuedCapture[]).filter((c) => typeof c?.text === 'string' && typeof c?.at === 'string') : [];
      } catch {
        return [];
      }
    },
    save(queue) {
      if (!storage) return;
      if (queue.length === 0) storage.removeItem(QUEUE_KEY);
      else storage.setItem(QUEUE_KEY, JSON.stringify(queue));
    },
  };
}

/** The sentence for an attachment while offline; Capture checks this before it reads the file, since WebKit refuses the read itself when offline. */
export const ATTACHMENT_OFFLINE = 'You are offline. Attachments are not queued; save this capture when you are back online.';

export class OfflineQueue {
  private flushing: Promise<CaptureResult[]> | null = null;

  constructor(
    private readonly state: PendingState,
    private readonly online: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    private readonly store: QueueStore = localQueueStore(null),
    private readonly now: () => string = nowUtc,
  ) {
    this.state.queue = store.load();
  }

  get hasPending(): boolean {
    return this.state.queue.length > 0;
  }

  /**
   * Save now when it can be; otherwise queue. An attachment that cannot be
   * saved now is refused, since files are not queued.
   */
  async capture(brain: BrainService, input: CaptureInput): Promise<{ saved: CaptureResult } | { queued: true }> {
    if (!this.online() || !brain.connected) return this.queue(input);
    try {
      return { saved: await captureToInbox(brain, input) };
    } catch (e) {
      if (e instanceof NetworkError) return this.queue(input);
      throw e;
    }
  }

  private queue(input: CaptureInput): { queued: true } {
    if (input.attachment) throw new Error(ATTACHMENT_OFFLINE);
    if (input.text.trim() === '') throw new Error('a capture needs some text');
    const at = (input.now ?? this.now)();
    const item: QueuedCapture = { id: `${at}-${this.state.queue.length}-${Math.random().toString(36).slice(2, 8)}`, text: input.text, at, ...(input.note ? { note: input.note } : {}) };
    // Written to the device before the screen is told: if the write fails, the form keeps the text.
    this.store.save([...this.state.queue, item]);
    this.state.queue = [...this.state.queue, item];
    return { queued: true };
  }

  /** Take a waiting capture out of the queue, to put it back in the form or to discard it. */
  remove(id: string): QueuedCapture | null {
    const item = this.state.queue.find((c) => c.id === id) ?? null;
    if (item) this.replace(this.state.queue.filter((c) => c.id !== id));
    return item;
  }

  private replace(queue: QueuedCapture[]): void {
    this.state.queue = queue;
    try {
      this.store.save(queue);
    } catch {
      // the queue in memory is still right; the next change writes it again
    }
  }

  /**
   * Save every waiting capture, oldest first, if online and connected. An
   * unreachable repository stops the run and everything keeps waiting. Any
   * other failure is written on that capture, which stays, and the run goes
   * on to the next. One run at a time.
   */
  flush(brain: BrainService): Promise<CaptureResult[]> {
    this.flushing ??= this.run(brain).finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async run(brain: BrainService): Promise<CaptureResult[]> {
    const saved: CaptureResult[] = [];
    for (const item of [...this.state.queue]) {
      if (!this.online() || !brain.connected) break;
      if (!this.state.queue.some((c) => c.id === item.id)) continue;
      try {
        const r = await captureToInbox(brain, { text: item.text, ...(item.note ? { note: item.note } : {}), now: () => item.at });
        this.replace(this.state.queue.filter((c) => c.id !== item.id));
        this.state.flushed = r;
        saved.push(r);
      } catch (e) {
        if (e instanceof NetworkError) break;
        this.replace(this.state.queue.map((c) => (c.id === item.id ? { ...c, error: describeError(e) } : c)));
      }
    }
    return saved;
  }
}

/** The capture form's unsaved text, kept on the device so leaving the screen or closing the app does not lose it. */
export interface Draft { text: string; note: string }
export function loadDraft(storage: Pick<Storage, 'getItem'> | null): Draft {
  try {
    const d = JSON.parse(storage?.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    return { text: typeof d?.text === 'string' ? d.text : '', note: typeof d?.note === 'string' ? d.note : '' };
  } catch {
    return { text: '', note: '' };
  }
}
export function saveDraft(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, draft: Draft): void {
  try {
    if (draft.text === '' && draft.note === '') storage?.removeItem(DRAFT_KEY);
    else storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // a full or blocked localStorage: the form still holds the text
  }
}
