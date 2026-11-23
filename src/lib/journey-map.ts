import type { Feature, FeatureCollection, MultiLineString } from 'geojson';
import { getJson } from './client';
import { clip, type Pt } from './clip';
import type { Journey, PlanData, RideLeg } from './planner';
import { poleName } from './text';
import type { SearchIndex } from './types';

export async function journeyGeo(j: Journey, data: PlanData, index: SearchIndex, start: Pt | null): Promise<FeatureCollection> {
  const at = (pole: number): Pt => [data.poles[pole]![3], data.poles[pole]![2]];
  const features: Feature[] = [];
  const stopFeature = (pole: number, color: string, label: string): Feature => {
    const [s, p] = data.poles[pole]!;
    const stop = index.stops[s]!;
    const many = stop.poles.length > 1;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: at(pole) },
      properties: { kind: 'stop', slug: stop.slug, name: stop.name, lines: stop.lines.join(','), color, pole: many ? stop.poles[p]!.id : '', side: many ? poleName(p) : '', label },
    };
  };
  const lineFeature = (kind: 'line' | 'walk', coordinates: Pt[], color: string): Feature => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind, color },
  });

  const rides = j.legs.filter((l): l is RideLeg => l.kind === 'ride');
  const shapes = new Map(await Promise.all(
    [...new Set(rides.map((r) => r.line))].map(async (l): Promise<[number, Pt[][]]> => {
      const geo = await getJson<FeatureCollection>(`/data/linija/${index.lines[l]!.slug}.json`);
      const f = geo.features.find((x) => x.geometry.type === 'MultiLineString');
      return [l, f ? ((f.geometry as MultiLineString).coordinates as Pt[][]) : []];
    }),
  ));

  let labelled = -1; // presjedanje na istoj stanici ispisuje naziv samo jednom
  for (const leg of j.legs) {
    if (leg.kind === 'walk') {
      const a = leg.from === null ? start : at(leg.from);
      if (a) features.push(lineFeature('walk', [a, at(leg.to)], '#757e88'));
      continue;
    }
    const color = index.lines[leg.line]!.color;
    const pts = leg.stops.map((s) => at(s.pole));
    features.push(lineFeature('line', clip(shapes.get(leg.line) ?? [], pts), color));
    leg.stops.forEach((s, i) => {
      const stop = data.poles[s.pole]![0];
      const label = (i === 0 || i === leg.stops.length - 1) && stop !== labelled;
      if (label) labelled = stop;
      features.push(stopFeature(s.pole, color, label ? index.stops[stop]!.name : ''));
    });
  }
  const last = j.legs.at(-1)!;
  if (last.kind === 'walk') features.push(stopFeature(last.to, '#757e88', index.stops[data.poles[last.to]![0]]!.name));
  if (start) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: start }, properties: { kind: 'here', label: 'Ti' } });
  return { type: 'FeatureCollection', features };
}
