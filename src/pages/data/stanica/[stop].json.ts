import type { APIContext } from 'astro';
import { boardRows, getStop, network } from '../../../lib/network';
import type { StopData } from '../../../lib/types';

export const getStaticPaths = () => network.stops.map((s) => ({ params: { stop: s.slug } }));

export function GET({ params }: APIContext) {
  const { slug, name, poles } = getStop(params.stop!);
  const data: StopData = { slug, name, poles, rows: boardRows(slug) };
  return Response.json(data);
}
