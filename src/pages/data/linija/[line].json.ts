import type { APIContext } from 'astro';
import { getLine, lineGeo, network } from '../../../lib/network';

export const getStaticPaths = () => network.lines.map((l) => ({ params: { line: l.slug } }));

export const GET = ({ params }: APIContext) => Response.json(lineGeo(getLine(params.line!)));
