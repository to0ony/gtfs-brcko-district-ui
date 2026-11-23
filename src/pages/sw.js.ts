import source from '../scripts/sw.js?raw';

// Svaki build ima svoju verziju, pa preglednik primijeti novi vozni red i obnovi spremljene stranice.
export const GET = () => new Response(source.replace('__VERSION__', Date.now().toString(36)), { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
