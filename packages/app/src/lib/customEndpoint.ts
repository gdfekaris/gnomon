// The custom model endpoint build setting (spec §15). Off unless whoever
// builds the app opts in with VITE_CUSTOM_ENDPOINT (in CI, the repository
// variable GNOMON_CUSTOM_ENDPOINT); gdfekaris/gnomon never sets it, so the
// app at gdfekaris.com is exactly as strict as before. `self` allows an
// endpoint on the app's own server, which the policy's 'self' already
// covers; an https origin is added to connect-src and nothing else is.
// Pure and DOM-free: vite.config.ts uses it at build time, the app at run
// time.

export type EndpointPolicy = { kind: 'off' } | { kind: 'self' } | { kind: 'origin'; origin: string };

export const ENDPOINT_SETTING = 'VITE_CUSTOM_ENDPOINT';

/** The build setting's value as a policy. Throws, naming the setting, when it is neither `self` nor a bare https origin. */
export function parseEndpointSetting(raw: string | undefined): EndpointPolicy {
  const value = (raw ?? '').trim();
  if (value === '') return { kind: 'off' };
  if (value === 'self') return { kind: 'self' };
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const bare = value.replace(/\/+$/, '');
  if (!url || url.protocol !== 'https:' || url.origin !== bare) {
    throw new Error(`${ENDPOINT_SETTING} must be "self" or an https origin such as https://model.example.com (no path), not '${value}'`);
  }
  return { kind: 'origin', origin: url.origin };
}

/** The page with the allowed origin added to connect-src. Off and `self` return the page unchanged, byte for byte. */
export function withEndpointCsp(html: string, policy: EndpointPolicy): string {
  if (policy.kind !== 'origin') return html;
  const at = html.indexOf('connect-src ');
  if (at === -1) throw new Error('the page has no connect-src directive to add the custom endpoint to');
  const end = html.indexOf(';', at);
  return `${html.slice(0, end)} ${policy.origin}${html.slice(end)}`;
}

/** Why an endpoint address cannot be used by this build, or null when it can. */
export function endpointProblem(address: string, policy: EndpointPolicy, pageOrigin: string): string | null {
  if (policy.kind === 'off') return 'This build of the app does not allow a custom endpoint.';
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return 'That is not a web address. It looks like https://model.example.com/v1.';
  }
  if (policy.kind === 'self') {
    return url.origin === pageOrigin ? null : `This build allows only an endpoint on its own server, ${pageOrigin}.`;
  }
  return url.origin === policy.origin ? null : `This build allows only an endpoint at ${policy.origin}.`;
}

/** The line for Settings → About: what this build allows. */
export function describePolicy(policy: EndpointPolicy): string {
  if (policy.kind === 'off') return 'Custom model endpoint: not enabled in this build.';
  if (policy.kind === 'self') return 'Custom model endpoint: enabled, on this app\'s own server.';
  return `Custom model endpoint: enabled, at ${policy.origin}.`;
}
