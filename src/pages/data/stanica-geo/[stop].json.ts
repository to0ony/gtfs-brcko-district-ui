import type { APIContext } from 'astro';
import { getStop, network, stopGeo } from '../../../lib/network';

export const getStaticPaths = () => network.stops.map((s) => ({ params: { stop: s.slug } }));

export const GET = ({ params }: APIContext) => Response.json(stopGeo(getStop(params.stop!)));
