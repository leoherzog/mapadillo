/**
 * Canonical icon set used by both frontend and worker, grouped as the icon picker shows it.
 */

export const ICON_CATEGORIES = {
  Basic: ['location-dot', 'none'],
  Outdoors: ['tree', 'leaf', 'flower', 'compass', 'fire', 'snowflake', 'sun', 'umbrella'],
  'Food & Drink': ['utensils', 'mug-hot', 'cake-candles', 'martini-glass', 'fish'],
  Sightseeing: ['camera', 'landmark', 'globe', 'ticket', 'crown'],
  Accommodation: ['house', 'bed'],
  Fun: ['star', 'trophy', 'gift', 'shop', 'paw', 'sparkles'],
  Transport: ['plane', 'ship', 'train', 'bus', 'car', 'suitcase'],
  People: ['heart', 'anchor'],
  Checklist: ['circle', 'square', 'circle-check', 'circle-plus', 'circle-info', 'circle-xmark'],
} as const;

export type ValidIcon = (typeof ICON_CATEGORIES)[keyof typeof ICON_CATEGORIES][number];

export const VALID_ICONS: ReadonlySet<string> = new Set<string>(Object.values(ICON_CATEGORIES).flat());

export const DEFAULT_ICON: ValidIcon = 'location-dot';
