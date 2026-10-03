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

  const nav: Navigation | undefined = window.navigation;
  if (nav) {
    nav.navigate(path, options?.replace ? { history: 'replace' } : undefined);
  } else {
    if (options?.replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/** Sign-in page URL that returns to `returnTo` after authentication, defaulting to the current page. */
export function signInUrl(returnTo = window.location.pathname + window.location.search): string {
  return `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}
