import { lineRef, network } from '../../lib/network';
import type { SearchIndex } from '../../lib/types';

export function GET() {
  const index: SearchIndex = {
    lines: network.lines.map((l) => ({ ...lineRef(l), long: l.long })),
    stops: network.stops.map(({ slug, name, poles, lines }) => ({ slug, name, poles, lines })),
  };
  return Response.json(index);
}
