import type { FeatureCollection } from 'geojson';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { convert, getJson } from './client';
import { poleHash } from './text';

const dark = () => document.documentElement.dataset.theme === 'dark';
const styleUrl = () => `https://tiles.openfreemap.org/styles/${dark() ? 'dark' : 'positron'}`;

function boundsOf(geo: FeatureCollection): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of geo.features) {
    if (f.geometry.type !== 'Point') continue;
    const [x, y] = f.geometry.coordinates as [number, number];
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  }
  return b;
}

/** Nazivi u OpenFreeMap stilovima su preblijedi; ovdje im je kontrast prema podlozi iznad 4.5:1. */
function legibleLabels(map: MapLibreMap) {
  const [text, halo] = dark() ? ['#b4bbc4', '#0c0c0c'] : ['#454d56', '#ffffff'];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
    map.setPaintProperty(layer.id, 'text-color', text);
    map.setPaintProperty(layer.id, 'text-halo-color', halo);
    map.setPaintProperty(layer.id, 'text-opacity', 1);
  }
}

/** Nazivi ispisani na karti u odabranom jeziku. */
const localized = (geo: FeatureCollection): FeatureCollection => ({
  ...geo,
  features: geo.features.map((f) => (f.properties?.label ? { ...f, properties: { ...f.properties, label: convert(f.properties.label) } } : f)),
});

function addLayers(map: MapLibreMap, geo: FeatureCollection, full: boolean) {
  if (map.getSource('net')) return;
  map.addSource('net', { type: 'geojson', data: localized(geo) });
  map.addLayer({
    id: 'routes', type: 'line', source: 'net', filter: ['==', ['get', 'kind'], 'line'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, full ? 4 : 5] },
  });
  map.addLayer({
    id: 'walk', type: 'line', source: 'net', filter: ['==', ['get', 'kind'], 'walk'],
    paint: { 'line-color': dark() ? '#b4bbc4' : '#565e68', 'line-width': 4, 'line-dasharray': [1, 1] },
  });
  map.addLayer({
    id: 'here', type: 'circle', source: 'net', filter: ['==', ['get', 'kind'], 'here'],
    paint: { 'circle-radius': 8, 'circle-color': '#1d4ed8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
  });
  map.addLayer({
    id: 'stops', type: 'circle', source: 'net', filter: ['==', ['get', 'kind'], 'stop'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1, 12, 3.5, 15, 7],
      'circle-color': '#ffffff',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 2],
    },
  });
}

/** Karta stanice: veće točke s brojem stajališta. */
function addPoles(map: MapLibreMap) {
  map.setPaintProperty('stops', 'circle-radius', ['case', ['==', ['get', 'num'], ''], 10, 14]);
  map.setPaintProperty('stops', 'circle-stroke-width', 3);
  map.addLayer({
    id: 'poles', type: 'symbol', source: 'net', filter: ['!=', ['get', 'num'], ''],
    layout: { 'text-field': ['get', 'num'], 'text-font': ['Noto Sans Bold'], 'text-size': 16, 'text-allow-overlap': true, 'text-ignore-placement': true },
  });
  paintPoles(map);
}

function addLabels(map: MapLibreMap) {
  if (map.getLayer('labels')) return;
  map.addLayer({
    id: 'labels', type: 'symbol', source: 'net', filter: ['!=', ['coalesce', ['get', 'label'], ''], ''],
    layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-max-width': 9,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 1.2,
    },
    paint: { 'text-color': dark() ? '#ffffff' : '#16191d', 'text-halo-color': dark() ? '#0c0c0c' : '#ffffff', 'text-halo-width': 2 },
  });
}

function paintPoles(map: MapLibreMap) {
  if (!map.getLayer('poles')) return;
  // Na voznom redu su istaknuta stajališta smjera, na stanici ono iz adrese. Jedino stajalište je uvijek istaknuto.
  const fixed = map.getContainer().dataset.on;
  const ids = (fixed ?? location.hash.replace(poleHash(''), '')).split(' ');
  const on: ExpressionSpecification = ['in', ['get', 'pole'], ['literal', ['', ...ids]]];
  const [ink, paper] = dark() ? ['#e8eaed', '#16191d'] : ['#16191d', '#ffffff'];
  map.setPaintProperty('stops', 'circle-color', ['case', on, '#ffc61a', ink]);
  map.setPaintProperty('stops', 'circle-stroke-color', ['case', on, '#16191d', paper]);
  map.setPaintProperty('poles', 'text-color', ['case', on, '#16191d', paper]);
}

/** MapLibre se u skrivenom elementu postavi na 400×300 i tako ostane, pa se čeka da element dobije veličinu. */
function whenSized(el: HTMLElement): Promise<void> {
  if (el.clientWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth) return;
      ro.disconnect();
      resolve();
    });
    ro.observe(el);
  });
}

export async function mountMap(el: HTMLElement, given?: FeatureCollection) {
  const note = el.querySelector('.map-note');
  try {
    const [gl, worker, , geo] = await Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      given ?? getJson<FeatureCollection>(el.dataset.src!),
    ]);
    gl.setWorkerUrl(worker.default);
    await whenSized(el);
    const full = el.classList.contains('full');
    const poles = el.classList.contains('poles');
    const bounds = boundsOf(geo);
    const map = new gl.Map({
      container: el, style: styleUrl(), bounds, fitBoundsOptions: { padding: given ? { top: 50, right: 60, bottom: 70, left: 60 } : poles ? { top: 45, right: 70, bottom: 60, left: 70 } : 40, maxZoom: 16.5 },
      cooperativeGestures: !full, attributionControl: { compact: true },
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Za zumiranje drži Ctrl i okreći kotačić',
        'CooperativeGesturesHandler.MacHelpText': 'Za zumiranje drži ⌘ i okreći kotačić',
        'CooperativeGesturesHandler.MobileHelpText': 'Kartu pomiči s dva prsta',
        'GeolocateControl.FindMyLocation': 'Moja lokacija',
        'GeolocateControl.LocationNotAvailable': 'Lokacija nije dostupna',
        'AttributionControl.ToggleAttribution': 'Izvor karte',
        'Map.Title': 'Karta',
        'NavigationControl.ZoomIn': 'Povećaj',
        'NavigationControl.ZoomOut': 'Smanji',
      },
    });
    note?.remove();
    map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right');
    if (full) map.addControl(new gl.GeolocateControl({ trackUserLocation: true }), 'top-right');

    map.on('style.load', () => { legibleLabels(map); addLayers(map, geo, full); if (poles) addPoles(map); if (given) addLabels(map); });
    // Na uskoj karti otvorena napomena o izvoru prekriva stajališta; ostaje gumb (i).
    if (poles && el.clientWidth < 500) map.once('load', () => {
      const box = el.querySelector('.maplibregl-ctrl-attrib');
      box?.classList.remove('maplibregl-compact-show');
      box?.removeAttribute('open');
    });
    if (poles) addEventListener('hashchange', () => paintPoles(map));
    addEventListener('jezikchange', () => map.getSource<GeoJSONSource>('net')?.setData(localized(geo)));
    addEventListener('themechange', () => map.setStyle(styleUrl()));

    const popup = (at: [number, number], { slug, name, lines, pole, side }: Record<string, string>) => {
      const box = document.createElement('div');
      const a = document.createElement('a');
      a.href = `/stanica/${slug}${pole ? poleHash(pole) : ''}`;
      a.textContent = name!;
      const p = document.createElement('p');
      p.textContent = `${side ? `${side}. ` : ''}Linije: ${lines!.toUpperCase().split(',').join(', ')}`;
      box.append(a, p);
      new gl.Popup({ closeButton: false, offset: 10 }).setLngLat(at).setDOMContent(box).addTo(map);
    };
    map.on('click', 'stops', (e) => {
      const f = e.features?.[0];
      if (f?.geometry.type !== 'Point') return;
      if (poles && el.dataset.on === undefined) {
        if (f.properties.pole) location.hash = poleHash(f.properties.pole);
        return;
      }
      popup(f.geometry.coordinates as [number, number], f.properties as Record<string, string>);
    });
    map.on('mouseenter', 'stops', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'stops', () => { map.getCanvas().style.cursor = ''; });

    const wanted = new URLSearchParams(location.search).get('stanica');
    const target = wanted && geo.features.find((f) => f.properties?.kind === 'stop' && f.properties.slug === wanted);
    if (target && target.geometry.type === 'Point') {
      const at = target.geometry.coordinates as [number, number];
      map.jumpTo({ center: at, zoom: 15 });
      popup(at, target.properties as Record<string, string>);
    }

    if (full) wireFilter(map);
  } catch (e) {
    console.error(e);
    if (note) note.textContent = 'Karta se nije učitala.';
  }
}

/** Gumbi linija na /karta: klik ostavlja samo odabranu liniju i njezine stanice. */
function wireFilter(map: MapLibreMap) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-line]')];
  const apply = () => {
    const slug = buttons.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.line;
    for (const b of buttons) b.classList.toggle('off', !!slug && b.dataset.line !== slug);
    if (!map.getLayer('routes')) return;
    const onLine: ExpressionSpecification = ['in', `,${slug},`, ['concat', ',', ['get', 'lines'], ',']];
    const routes: FilterSpecification = slug
      ? ['all', ['==', ['get', 'kind'], 'line'], ['==', ['get', 'slug'], slug]]
      : ['==', ['get', 'kind'], 'line'];
    const stops: FilterSpecification = slug
      ? ['all', ['==', ['get', 'kind'], 'stop'], onLine]
      : ['==', ['get', 'kind'], 'stop'];
    map.setFilter('routes', routes);
    map.setFilter('stops', stops);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b && on));
      apply();
    });
  }
  map.on('style.load', apply);
}

