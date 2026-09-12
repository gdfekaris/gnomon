// A pressed button stays pressed until its work is done (maintainer,
// 2026-09-11): `use:hold={busy}` marks the button `aria-busy` while `busy`
// holds, and app.css draws a busy button exactly as a pressed one. The mark
// lasts at least HOLD_MS even when the work is instant, so a tap reads as a
// press and a release rather than a flicker. Framework-free so it is unit
// tested against a stub element.

export const HOLD_MS = 150;

interface Pressable {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
}

export function hold(node: Pressable, busy: boolean, now: () => number = Date.now) {
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = (b: boolean) => {
    if (b) {
      clearTimeout(timer);
      if (!node.hasAttribute('aria-busy')) since = now();
      node.setAttribute('aria-busy', 'true');
      return;
    }
    if (!node.hasAttribute('aria-busy')) return;
    clearTimeout(timer);
    timer = setTimeout(() => node.removeAttribute('aria-busy'), Math.max(0, HOLD_MS - (now() - since)));
  };
  apply(busy);
  return { update: apply, destroy: () => clearTimeout(timer) };
}
