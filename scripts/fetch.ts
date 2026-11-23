// Skida najnoviji GTFS u data/gtfs.zip. Build koristi tu kopiju, pa ne ovisi o mreži.
import { mkdir, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { city } from '../city.config.ts';

const res = await fetch(city.feedUrl, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`Feed je vratio HTTP ${res.status}`);
const zip = new Uint8Array(await res.arrayBuffer());

const files = Object.keys(unzipSync(zip));
for (const f of ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt', 'calendar.txt']) {
  if (!files.includes(f)) throw new Error(`U feedu nedostaje ${f}`);
}
await mkdir('data', { recursive: true });
await writeFile('data/gtfs.zip', zip);
console.log(`data/gtfs.zip: ${(zip.length / 1024).toFixed(0)} KB`);
