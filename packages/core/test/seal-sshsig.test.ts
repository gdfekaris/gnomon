// Schema §11.8: FIDO (sk-ssh-ed25519) SSHSIG signatures. OpenSSH's own test
// vector proves the wire format; `ssh-keygen -Y verify`, where installed,
// accepts what the test authenticator makes, so the two agree.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEAL_NAMESPACE, parseSkPublicKey, utf8, verifySignature, verifySshsig } from '../src/index';
import { skSigner } from './seal-world';

const dir = fileURLToPath(new URL('../fixtures/sshsig/', import.meta.url));
const vector = {
  pub: readFileSync(join(dir, 'ed25519_sk.pub'), 'utf8'),
  sig: readFileSync(join(dir, 'ed25519_sk.sig'), 'utf8'),
  namespace: readFileSync(join(dir, 'namespace'), 'utf8').trim(),
  data: new Uint8Array(readFileSync(join(dir, 'signed-data'))),
};

let sshKeygen = false;
try {
  execFileSync('ssh-keygen', ['-Y', 'verify', '-?'], { stdio: 'ignore' });
} catch (e) {
  sshKeygen = (e as { status?: number }).status !== undefined && (e as { code?: string }).code !== 'ENOENT';
}

describe('OpenSSH test vector (regress/unittests/sshsig)', () => {
  it('verifies', async () => {
    expect(vector.namespace).toBe('unittest');
    expect(await verifySshsig(vector.sig, vector.pub, vector.data, vector.namespace)).toBe(true);
  });
  it('fails in another namespace, over other data, or under another key', async () => {
    expect(await verifySshsig(vector.sig, vector.pub, vector.data)).toBe(false);
    expect(await verifySshsig(vector.sig, vector.pub, utf8('This is a test, this is only a tesT'), vector.namespace)).toBe(false);
    const other = await skSigner(new Uint8Array(32).fill(5));
    expect(await verifySshsig(vector.sig, other.pub, vector.data, vector.namespace)).toBe(false);
  });
  it('fails when a byte of the signature changes', async () => {
    const lines = vector.sig.trim().split('\n');
    const body = lines.slice(1, -1).join('');
    for (const at of [20, body.length - 12, body.length - 5]) {
      const c = body[at] === 'A' ? 'B' : 'A';
      const bent = [lines[0], body.slice(0, at) + c + body.slice(at + 1), lines[lines.length - 1]].join('\n');
      expect(await verifySshsig(bent, vector.pub, vector.data, vector.namespace)).toBe(false);
    }
  });
  it('parses the key line', () => {
    const k = parseSkPublicKey(vector.pub);
    expect(k.application).toBe('ssh:');
    expect(k.pk).toHaveLength(32);
    expect(() => parseSkPublicKey('ssh-ed25519 AAAA')).toThrow();
  });
});

describe('Gnomon seal signatures from a FIDO key', () => {
  it('verify in the gnomon-seal@v1 namespace, with user presence', async () => {
    const k = await skSigner(new Uint8Array(32).fill(6));
    const msg = utf8('gnomon-seal v1\n{"v":1}');
    expect(await verifySignature('sk-ed25519', k.pub, await k.sign(msg), msg)).toBe(true);
  });
  it('fail without the user-presence flag: no touch, no seal', async () => {
    const k = await skSigner(new Uint8Array(32).fill(6), { flags: 0x00 });
    const msg = utf8('gnomon-seal v1\n{}');
    expect(await verifySignature('sk-ed25519', k.pub, await k.sign(msg), msg)).toBe(false);
    const withUv = await skSigner(new Uint8Array(32).fill(6), { flags: 0x05 });
    expect(await verifySignature('sk-ed25519', withUv.pub, await withUv.sign(msg), msg)).toBe(true);
  });
  it('fail when made in another namespace', async () => {
    const k = await skSigner(new Uint8Array(32).fill(6), { namespace: 'git' });
    const msg = utf8('gnomon-seal v1\n{}');
    expect(await verifySignature('sk-ed25519', k.pub, await k.sign(msg), msg)).toBe(false);
  });
  it.runIf(sshKeygen)('are accepted by ssh-keygen -Y verify', async () => {
    const k = await skSigner(new Uint8Array(32).fill(6));
    const msg = utf8('gnomon-seal v1\n{"stem":"20261005-120000-abc"}');
    const tmp = mkdtempSync(join(tmpdir(), 'gnomon-sshsig-'));
    try {
      writeFileSync(join(tmp, 'allowed'), `gnomon ${k.pub}\n`);
      writeFileSync(join(tmp, 'sig'), `${await k.sign(msg)}\n`);
      const out = execFileSync('ssh-keygen', ['-Y', 'verify', '-f', join(tmp, 'allowed'), '-I', 'gnomon', '-n', SEAL_NAMESPACE, '-s', join(tmp, 'sig')], { input: msg, encoding: 'utf8' });
      expect(out).toMatch(/Good "gnomon-seal@v1" signature/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
