// Hash-based router (spec §10.1): GitHub Pages cannot rewrite paths, and hash
// routes survive refresh and home-screen launch. Routes are a placeholder table
// until the screens exist.

export const ROUTES = ['capture', 'browse', 'inbox', 'proposals', 'sets', 'reason', 'settings', 'onboarding'] as const;
export type RouteName = (typeof ROUTES)[number];

function parse(hash: string): { name: RouteName; rest: string[] } {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const first = parts[0];
  const name = (ROUTES as readonly string[]).includes(first ?? '') ? (first as RouteName) : 'capture';
  return { name, rest: parts.slice(1) };
}

export const route = $state(parse(typeof location === 'undefined' ? '' : location.hash));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const next = parse(location.hash);
    route.name = next.name;
    route.rest = next.rest;
  });
}
