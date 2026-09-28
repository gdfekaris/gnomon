import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describePolicy, endpointProblem, parseEndpointSetting, withEndpointCsp } from '../src/lib/customEndpoint';
import { ReasoningService } from '../src/lib/services/reasoning';

// The custom model endpoint build setting (spec §15): off by default, opted into by whoever builds the app.

const PAGE = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const connectSrc = (html: string) => /connect-src ([^;]*);/.exec(html)![1];

describe('the build setting', () => {
  it('is off unless set; "self" and a bare https origin are the only other values', () => {
    expect(parseEndpointSetting(undefined)).toEqual({ kind: 'off' });
    expect(parseEndpointSetting('  ')).toEqual({ kind: 'off' });
    expect(parseEndpointSetting('self')).toEqual({ kind: 'self' });
    expect(parseEndpointSetting('https://model.example.com')).toEqual({ kind: 'origin', origin: 'https://model.example.com' });
    expect(parseEndpointSetting('https://model.example.com/')).toEqual({ kind: 'origin', origin: 'https://model.example.com' });
    for (const bad of ['http://model.example.com', 'https://model.example.com/v1', 'model.example.com', '*', 'https:']) {
      expect(() => parseEndpointSetting(bad), bad).toThrow(/VITE_CUSTOM_ENDPOINT must be "self" or an https origin/);
    }
  });

  it('off and "self" leave the page byte for byte as it is; an origin joins connect-src and nothing else', () => {
    expect(withEndpointCsp(PAGE, { kind: 'off' })).toBe(PAGE);
    expect(withEndpointCsp(PAGE, { kind: 'self' })).toBe(PAGE);
    const opened = withEndpointCsp(PAGE, { kind: 'origin', origin: 'https://model.example.com' });
    expect(connectSrc(opened)).toBe(`${connectSrc(PAGE)} https://model.example.com`);
    expect(opened.replace(' https://model.example.com', '')).toBe(PAGE);
  });

  it('the page as shipped allows the app, GitHub, Anthropic, and OpenRouter, and no other address', () => {
    expect(connectSrc(PAGE)).toBe("'self' https://api.github.com https://api.anthropic.com https://openrouter.ai");
  });
});

describe('which addresses a build can use', () => {
  const ORIGIN = 'https://brain.example.com';
  it('a build that did not opt in allows none', () => {
    expect(endpointProblem(`${ORIGIN}/v1`, { kind: 'off' }, ORIGIN)).toBe('This build of the app does not allow a custom endpoint.');
  });
  it('"self" allows the app\'s own server only', () => {
    expect(endpointProblem(`${ORIGIN}/v1`, { kind: 'self' }, ORIGIN)).toBeNull();
    expect(endpointProblem('https://elsewhere.example.com/v1', { kind: 'self' }, ORIGIN)).toBe(`This build allows only an endpoint on its own server, ${ORIGIN}.`);
  });
  it('an origin allows that origin only', () => {
    const policy = { kind: 'origin' as const, origin: 'https://model.example.com' };
    expect(endpointProblem('https://model.example.com/v1', policy, ORIGIN)).toBeNull();
    expect(endpointProblem('https://model.example.com:8443/v1', policy, ORIGIN)).toBe('This build allows only an endpoint at https://model.example.com.');
    expect(endpointProblem('not a url', policy, ORIGIN)).toBe('That is not a web address. It looks like https://model.example.com/v1.');
  });
  it('Settings → About says what the build allows', () => {
    expect(describePolicy({ kind: 'off' })).toBe('Custom model endpoint: not enabled in this build.');
    expect(describePolicy({ kind: 'self' })).toBe('Custom model endpoint: enabled, on this app\'s own server.');
    expect(describePolicy({ kind: 'origin', origin: 'https://m.test' })).toBe('Custom model endpoint: enabled, at https://m.test.');
  });
});

describe('the reasoning service', () => {
  it('offers "custom" only when an endpoint is configured', () => {
    const state = { transcript: [], streaming: false, error: null, preview: null };
    const r = new ReasoningService(state, { openrouter: 'k' });
    expect(r.providerIds).toEqual(['mock', 'openrouter']);
    r.configure({ custom: { url: 'https://brain.example.com/v1', key: '', contextWindow: 32_768 } });
    expect(r.providerIds).toEqual(['mock', 'custom']);
    expect(r.driver('custom').id).toBe('custom');
  });
});
