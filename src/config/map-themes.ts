/** Map theme definitions and controller options per theme. */

export type MapThemeId = 'bright' | 'kid-drawn';

export interface MapTheme {
  id: MapThemeId;
  name: string;
  icon: string;
}

export const MAP_THEMES: MapTheme[] = [
  { id: 'bright', name: 'Classic', icon: 'map' },
  { id: 'kid-drawn', name: 'Kid-Drawn', icon: 'paintbrush' },
];

export const DEFAULT_THEME: MapThemeId = 'kid-drawn';

export interface MapControllerOptions {
  labelFont?: string[];
  labelColor?: string;
  labelHaloColor?: string;
}

export function getControllerOptions(themeId: MapThemeId): MapControllerOptions {
  if (themeId === 'kid-drawn') {
    return {
      labelColor: '#4E342E',
      labelHaloColor: 'rgba(255, 248, 231, 0.9)',
    };
  }
  return {};
}
