// Route parsing (spec §10.1), rune-free so it runs under vitest. A route is
// `#/name/rest/of/path?query#anchor`; the trailing `#anchor` is a heading
// anchor inside a brain file (schema §6).

export const ROUTES = ['capture', 'browse', 'inbox', 'proposals', 'sets', 'reason', 'settings', 'onboarding', 'edit'] as const;
export type RouteName = (typeof ROUTES)[number];

export interface Route { name: RouteName; rest: string[]; path: string; anchor: string | undefined; query: URLSearchParams; }

export function parseRoute(hash: string): Route {
  let h = hash.replace(/^#\/?/, '');
  const anchorAt = h.indexOf('#');
  const anchor = anchorAt === -1 ? undefined : h.slice(anchorAt + 1);
  if (anchorAt !== -1) h = h.slice(0, anchorAt);
  const queryAt = h.indexOf('?');
  const query = new URLSearchParams(queryAt === -1 ? '' : h.slice(queryAt + 1));
  if (queryAt !== -1) h = h.slice(0, queryAt);
  const parts = h.split('/').filter(Boolean);
  const first = parts[0];
  const name = (ROUTES as readonly string[]).includes(first ?? '') ? (first as RouteName) : 'capture';
  const rest = parts.slice(1);
  return { name, rest, path: rest.join('/'), anchor, query };
}
