import type { InboxState } from '../services/inbox';
export const inbox = $state<InboxState>({ filings: [], loading: false, processing: null, results: [], error: null });
