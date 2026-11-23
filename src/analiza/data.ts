// Samo za build: izračun se radi jednom i dijele ga stranica i /data/analiza.json.
import naselja from '../../data/naselja.json';
import { labels, network } from '../lib/network';
import { analyze, type RawSettlement } from './compute';

export const analysis = analyze(network, labels, naselja as unknown as RawSettlement[]);
