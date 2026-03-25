/**
 * Shared navigation utility.
 *
 * Uses the Navigation API when available, with a History API fallback.
 * All programmatic navigation in child components should go through this
 * instead of reimplementing Navigation API access.
 */
export function navigateTo(path: string, options?: { replace?: boolean }): void {
  // Avoid duplicate history entries if already at this URL
  if (new URL(path, location.origin).href === location.href) return;

  const nav = (window as unknown as { navigation?: { navigate: (url: string, opts?: { history?: string }) => void } }).navigation;
  if (nav) {
    nav.navigate(path, options?.replace ? { history: 'replace' } : undefined);
  } else {
    if (options?.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/**
 * Returns a click handler that prevents default and navigates via the router.
 * Memoized per path so that Lit receives a stable function reference and
 * does not re-bind the event listener on every render.
 *
 * Usage: `@click=${navClick('/dashboard')}`
 */
const _navClickCache = new Map<string, (e: Event) => void>();

export function navClick(path: string): (e: Event) => void {
  let handler = _navClickCache.get(path);
  if (!handler) {
    handler = (e: Event) => {
      e.preventDefault();
      navigateTo(path);
    };
    _navClickCache.set(path, handler);
  }
  return handler;
}
