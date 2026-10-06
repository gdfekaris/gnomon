// Seal encodings — schema §11.1 and §11.3: digests, canonical JSON, and the
// signed bytes of a payload. Pure, no DOM or Node types.
import { normalizeBody } from '../schema/parse';

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

export const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

export const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** `sha256:` and 64 lowercase hex digits (schema §11.1). */
export async function digest(bytes: Uint8Array): Promise<string> {
  return `sha256:${hex(await sha256(bytes))}`;
}

/** Body bytes (schema §11.1) of a body already split from its frontmatter and decrypted. */
export const bodyBytes = (body: string): Uint8Array<ArrayBuffer> => utf8(normalizeBody(body));

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * RFC 8785 for the values a payload may hold (schema §11.3): objects, strings,
 * null, and integers from 0 to 2^53 − 1. Keys sort by UTF-16 code units, which
 * is what Array.prototype.sort does by default; strings escape as JSON.stringify.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (LONE_SURROGATE.test(value)) throw new Error('a payload string holds a lone surrogate');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`a payload number must be an integer from 0 to 2^53 - 1, not ${value}`);
    return String(value);
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${canonicalJson(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  throw new Error(`a payload cannot hold ${Array.isArray(value) ? 'an array' : typeof value}`);
}

export type SignedKind = 'seal' | 'enroll' | 'revoke';

const CONTEXT: Record<SignedKind, string> = { seal: 'gnomon-seal v1', enroll: 'gnomon-enroll v1', revoke: 'gnomon-revoke v1' };

/** The context line, then the canonical payload (schema §11.3). */
export const signedBytes = (kind: SignedKind, payload: unknown): Uint8Array<ArrayBuffer> => utf8(`${CONTEXT[kind]}\n${canonicalJson(payload)}`);
