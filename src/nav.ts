/**
 * Shared navigation utility.
 *
 * Uses the Navigation API when available, with a History API fallback.
 * All programmatic navigation in child components should go through this
 * instead of reimplementing Navigation API access.
 */
export function navigateTo(path: string): void {
  // Avoid duplicate history entries if already at this URL
  if (new URL(path, location.origin).href === location.href) return;

  if ('navigation' in window) {
    (
      window as unknown as {
        navigation: { navigate: (url: string) => void };
      }
    ).navigation.navigate(path);
  } else {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

/**
 * Returns a click handler that prevents default and navigates via the router.
 * Usage: `@click=${navClick('/dashboard')}`
 */
export function navClick(path: string) {
  return (e: Event) => {
    e.preventDefault();
    navigateTo(path);
  };
}
