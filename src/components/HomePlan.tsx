import { useState } from 'preact/hooks';
import StopInput, { type Place } from './StopInput';

const param = (p: Place) => (p.kind === 'here' ? 'lokacija' : p.slug);

/** Od–Do na početnoj; rezultat je na /put. */
export default function HomePlan({ stops }: { stops: { slug: string; name: string }[] }) {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  return (
    <form
      class="home-plan"
      action="/put"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new URLSearchParams();
        if (from) q.set('od', param(from));
        if (to) q.set('do', param(to));
        location.assign(`/put?${q}`);
      }}
    >
      <StopInput label="Od" value={from} stops={stops} allowHere onChange={setFrom} />
      <StopInput label="Do" value={to} stops={stops} onChange={setTo} />
      <button type="submit" class="button primary">Pronađi put</button>
    </form>
  );
}
