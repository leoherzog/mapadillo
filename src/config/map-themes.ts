/** Map controller options for the kid-drawn theme. */

export interface MapControllerOptions {
  labelFont?: string[];
  labelColor?: string;
  labelHaloColor?: string;
  onItemClick?: (itemId: string) => void;
}

export const MAP_CONTROLLER_OPTIONS: MapControllerOptions = {
  labelColor: '#4E342E',
  labelHaloColor: 'rgba(255, 248, 231, 0.9)',
};
