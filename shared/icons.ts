/**
 * Canonical set of valid icon names used by both frontend and worker.
 */

const ICON_NAMES = [
  'none',
  'location-dot',
  'tree', 'leaf', 'flower', 'compass', 'fire', 'snowflake', 'sun', 'umbrella',
  'utensils', 'mug-hot', 'cake-candles', 'martini-glass', 'fish',
  'camera', 'landmark', 'globe', 'ticket', 'crown',
  'house', 'bed',
  'star', 'trophy', 'gift', 'shop', 'paw', 'sparkles',
  'plane', 'ship', 'train', 'bus', 'car', 'suitcase',
  'heart', 'anchor',
  'circle', 'square', 'circle-check', 'circle-plus', 'circle-info', 'circle-xmark',
] as const;

export type ValidIcon = (typeof ICON_NAMES)[number];

export const VALID_ICONS: ReadonlySet<string> = new Set<string>(ICON_NAMES);

export const DEFAULT_ICON: ValidIcon = 'location-dot';
