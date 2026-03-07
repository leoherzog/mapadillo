/**
 * Canonical set of valid travel mode names used by both frontend and worker.
 */

const MODE_NAMES = ['drive', 'walk', 'bike', 'plane', 'boat'] as const;

export const VALID_TRAVEL_MODES: ReadonlySet<string> = new Set<string>(MODE_NAMES);
