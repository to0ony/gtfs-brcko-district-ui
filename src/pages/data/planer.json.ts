import { network } from '../../lib/network';
import type { PlanData } from '../../lib/planner';

export function GET() {
  const poles: PlanData['poles'] = [];
  const poleIndex = new Map<string, number>();
  network.stops.forEach((s, stop) =>
    s.poles.forEach((p, i) => {
      poleIndex.set(`${s.slug}|${i}`, poles.length);
      poles.push([stop, i, p.lat, p.lon]);
    }),
  );
  const headsigns: string[] = [];
  const headsign = (name: string) => {
    const at = headsigns.indexOf(name);
    return at >= 0 ? at : headsigns.push(name) - 1;
  };
  const trips: PlanData['trips'] = network.lines.flatMap((line, l) =>
    line.dirs.flatMap((dir) =>
      dir.trips.map((t): PlanData['trips'][number] => {
        const visits = t.times
          .flatMap((m, i) => (m === null ? [] : [{ m, i, pole: poleIndex.get(`${dir.stops[i]!.slug}|${t.poles[i]}`)! }]))
          .sort((a, b) => a.m - b.m || a.i - b.i);
        return [l, dir.id, headsign(t.headsign), t.svc, visits.flatMap((v) => [v.pole, v.m])];
      }),
    ),
  );
  return Response.json({ poles, headsigns, trips } satisfies PlanData);
}
