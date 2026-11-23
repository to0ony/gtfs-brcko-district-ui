import { networkGeo } from '../../lib/network';

export const GET = () => Response.json(networkGeo());
