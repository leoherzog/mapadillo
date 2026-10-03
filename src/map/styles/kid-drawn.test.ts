import { describe, expect, it } from 'vitest';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { transformToKidDrawn } from './kid-drawn.js';

const WIDTH = ['interpolate', ['exponential', 1.2], ['zoom'], 6.5, 0, 7, 0.5, 20, 18];

function line(id: string): LayerSpecification {
  return {
    id,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    paint: { 'line-color': '#000', 'line-width': structuredClone(WIDTH) as never },
  };
}

function transform(layers: LayerSpecification[]): Record<string, LayerSpecification> {
  const style: StyleSpecification = { version: 8, sources: {}, layers };
  return Object.fromEntries(transformToKidDrawn(style).layers.map((l) => [l.id, l]));
}

function paintOf(layer: LayerSpecification): Record<string, unknown> {
  return (layer as { paint: Record<string, unknown> }).paint;
}

describe('transformToKidDrawn', () => {
  it('widens interpolate outputs and leaves zoom stops alone', () => {
    const { 'highway-motorway': motorway } = transform([line('highway-motorway')]);
    const width = paintOf(motorway)['line-width'] as unknown[];
    expect(width.slice(0, 3)).toEqual(['interpolate', ['exponential', 1.2], ['zoom']]);
    expect(width[3]).toBe(6.5);
    expect(width[5]).toBe(7);
    expect(width[7]).toBe(20);
    expect(width[6]).toBeCloseTo(0.65);
    expect(width[8]).toBeCloseTo(23.4);
  });

  it('widens step outputs, including the default output', () => {
    const layer: LayerSpecification = {
      id: 'label_city',
      type: 'symbol',
      source: 'openmaptiles',
      layout: { 'text-size': ['step', ['zoom'], 10, 8, 20] as never },
    };
    const { label_city: city } = transform([layer]);
    const size = (city as { layout: Record<string, unknown> }).layout['text-size'] as unknown[];
    expect(size[0]).toBe('step');
    expect(size[2]).toBeCloseTo(11.5);
    expect(size[3]).toBe(8);
    expect(size[4]).toBeCloseTo(23);
  });

  it('widens shared trunk/primary bridge and tunnel casings like the trunk casing', () => {
    const layers = transform([line('tunnel-trunk-primary-casing'), line('highway-trunk-casing')]);
    const tunnel = paintOf(layers['tunnel-trunk-primary-casing'])['line-width'] as unknown[];
    expect(tunnel[8]).toBeCloseTo(19.8);
    expect(tunnel).toEqual(paintOf(layers['highway-trunk-casing'])['line-width']);
  });

  it('colors shared trunk/primary bridge and tunnel layers by road class', () => {
    const layers = transform([
      line('bridge-trunk-primary'),
      line('tunnel-trunk-primary-casing'),
      line('highway-trunk'),
      line('highway-primary'),
    ]);
    expect(paintOf(layers['bridge-trunk-primary'])['line-color'])
      .toEqual(['match', ['get', 'class'], 'trunk', '#FF6B4A', '#FFD54F']);
    expect(paintOf(layers['tunnel-trunk-primary-casing'])['line-color'])
      .toEqual(['match', ['get', 'class'], 'trunk', '#E55A3A', '#F5C342']);
    expect(paintOf(layers['highway-trunk'])['line-color']).toBe('#FF6B4A');
    expect(paintOf(layers['highway-primary'])['line-color']).toBe('#FFD54F');
  });
});
