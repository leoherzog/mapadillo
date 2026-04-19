/**
 * Canonical distance-unit values used by both frontend and worker.
 */

const UNIT_NAMES = ['km', 'mi'] as const;

export type Units = (typeof UNIT_NAMES)[number];

export const VALID_UNITS: ReadonlySet<string> = new Set<string>(UNIT_NAMES);
