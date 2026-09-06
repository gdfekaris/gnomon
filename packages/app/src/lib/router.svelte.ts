// Hash-based router (spec §10.1): GitHub Pages cannot rewrite paths, and hash
// routes survive refresh and home-screen launch. The reactive route state;
// parsing lives in route.ts.
import { type Route, parseRoute } from './route';
export { ROUTES, type Route, type RouteName, parseRoute } from './route';

export const route = $state<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const next = parseRoute(location.hash);
    route.name = next.name;
    route.rest = next.rest;
    route.path = next.path;
    route.anchor = next.anchor;
    route.query = next.query;
  });
}
