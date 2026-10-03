/**
 * Paper literals shared by the export pipeline, persisted export settings
 * and the print product catalog.
 */

export const PAPER_SIZE_VALUES = ['letter', 'a4', 'a3', 'tabloid', '18x24', '24x36', '40x60', 'a2', 'a1'] as const;
export type PaperSize = (typeof PAPER_SIZE_VALUES)[number];
export type Orientation = 'landscape' | 'portrait';

/** True when `v` is a known paper size literal. */
export function isPaperSize(v: unknown): v is PaperSize {
  return (PAPER_SIZE_VALUES as readonly unknown[]).includes(v);
}
