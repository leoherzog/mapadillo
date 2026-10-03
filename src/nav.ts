/**
 * Programmatic navigation for the router and pages. Uses the Navigation API when present;
 * otherwise updates history and dispatches a synthetic popstate, which the router's
 * fallback listener renders.
 */

/**
 * Navigate in place to `path`. Does nothing when `path` is already the current URL.
 * @param options.replace Replace the current history entry instead of pushing one.
 */
export function navigateTo(path: string, options?: { replace?: boolean }): void {
  if (new URL(path, window.location.origin).href === window.location.href) return;

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
