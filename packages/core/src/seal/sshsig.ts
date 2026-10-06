// OpenSSH FIDO signatures — schema §11.8. A seal by an `sk-ed25519` key is an
// armored SSHSIG over the seal's signed bytes, made by `ssh-keygen -Y sign`
// with the YubiKey. Verified here byte for byte; tested against OpenSSH's own
// vectors (fixtures/sshsig) and against `ssh-keygen -Y verify`.
import { fromBase64 } from '../crypto/body';
import { loadSodium } from '../crypto/passphrase';
import { concat, sha256, utf8 } from './encoding';

export const SK_ED25519 = 'sk-ssh-ed25519@openssh.com';
export const SEAL_NAMESPACE = 'gnomon-seal@v1';
const BEGIN = '-----BEGIN SSH SIGNATURE-----';
const END = '-----END SSH SIGNATURE-----';

class Reader {
  private at = 0;
  constructor(private readonly b: Uint8Array) {}
  u8(): number {
    if (this.at + 1 > this.b.length) throw new Error('truncated');
    return this.b[this.at++]!;
  }
  u32(): number {
    if (this.at + 4 > this.b.length) throw new Error('truncated');
    const v = ((this.b[this.at]! << 24) >>> 0) + (this.b[this.at + 1]! << 16) + (this.b[this.at + 2]! << 8) + this.b[this.at + 3]!;
    this.at += 4;
    return v;
  }
  raw(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw new Error('truncated');
    const out = this.b.slice(this.at, this.at + n);
    this.at += n;
    return out;
  }
  string(): Uint8Array {
    return this.raw(this.u32());
  }
  text(): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(this.string());
  }
  done(): void {
    if (this.at !== this.b.length) throw new Error('trailing bytes');
  }
}

const u32 = (n: number): Uint8Array => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
/** The SSH wire `string`: a 4-byte big-endian length, then the bytes. */
export const sshString = (b: Uint8Array | string): Uint8Array => {
  const bytes = typeof b === 'string' ? utf8(b) : b;
  return concat(u32(bytes.length), bytes);
};

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export interface SkPublicKey { blob: Uint8Array; pk: Uint8Array; application: string }

/** The key blob of an OpenSSH `sk-ssh-ed25519@openssh.com <base64> [comment]` line; throws when it is not one. */
export function parseSkPublicKey(line: string): SkPublicKey {
  const [type, b64] = line.trim().split(/\s+/);
  if (type !== SK_ED25519 || !b64) throw new Error(`not an ${SK_ED25519} public key`);
  const blob = fromBase64(b64);
  const r = new Reader(blob);
  if (r.text() !== SK_ED25519) throw new Error('the key blob names another type');
  const pk = r.string();
  if (pk.length !== 32) throw new Error('the key is not 32 bytes');
  const application = r.text();
  r.done();
  return { blob, pk, application };
}

/**
 * Schema §11.8: true when `armored` is a valid SSHSIG by the key `publicKeyLine`
 * over `message` in `namespace`, with the user-presence flag set. Never throws.
 */
export async function verifySshsig(armored: string, publicKeyLine: string, message: Uint8Array, namespace = SEAL_NAMESPACE): Promise<boolean> {
  try {
    const key = parseSkPublicKey(publicKeyLine);
    const lines = armored.trim().split(/\r?\n/);
    if (lines[0] !== BEGIN || lines[lines.length - 1] !== END) return false;
    const r = new Reader(fromBase64(lines.slice(1, -1).join('')));
    if (new TextDecoder().decode(r.raw(6)) !== 'SSHSIG' || r.u32() !== 1) return false;
    const publickey = r.string();
    const ns = r.string();
    const reserved = r.string();
    const hashName = r.text();
    const signature = r.string();
    r.done();
    if (!equal(publickey, key.blob) || !equal(ns, utf8(namespace)) || reserved.length !== 0) return false;
    if (hashName !== 'sha512' && hashName !== 'sha256') return false;

    const s = new Reader(signature);
    if (s.text() !== SK_ED25519) return false;
    const sig = s.string();
    const flags = s.u8();
    const counter = s.u32();
    s.done();
    if (sig.length !== 64 || (flags & 0x01) === 0) return false;

    const hm = new Uint8Array(await crypto.subtle.digest(hashName === 'sha512' ? 'SHA-512' : 'SHA-256', new Uint8Array(message)));
    const d = concat(utf8('SSHSIG'), sshString(ns), sshString(reserved), sshString(hashName), sshString(hm));
    const signed = concat(await sha256(utf8(key.application)), new Uint8Array([flags]), u32(counter), await sha256(d));
    const sodium = await loadSodium();
    return sodium.crypto_sign_verify_detached(sig, signed, key.pk);
  } catch {
    return false;
  }
}
