# Brčko busom

Statični vozni red autobusa u Brčkom, složen iz [GTFS feeda](https://mobilitydatabase.org/feeds/gtfs/mdb-3647). Neslužbeno. Nema backenda.

## Pokretanje

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # dist/
npm test             # logika vremena i kalendara
npm run check        # tipovi
npm run gtfs:fetch   # skini najnoviji feed u data/gtfs.zip
```

Treba Node 24.

## Kako radi

1. `data/gtfs.zip` je kopija feeda u repou, pa build ne ovisi o mreži.
2. `scripts/gtfs.ts` je pretvara u `src/generated/*.json`.
3. Astro gradi po jednu stranicu za svaku liniju, stanicu i par linija + stanica.
4. Preglednik prema satu u zoni `Europe/Sarajevo` odredi vrstu dana i sljedeći polazak. Bez JS-a se i dalje vidi cijeli vozni red.

Nakon isteka feeda stranica pokazuje upozorenje i koristi uobičajeni raspored za taj dan u tjednu.

## Jezici

Izvor svih tekstova je hrvatska latinica. `src/scripts/jezik.js` u pregledniku prikazuje bosanski, srpski latinicom i srpski ćirilicom: rječnik `WORDS` sadrži samo izraze koji se razlikuju, sa svakim padežom posebno. Novi tekst piši na hrvatskom i dodaj izraz u rječnik samo ako se razlikuje; `npm test` pazi da rječnik ne dira nazive stanica i linija.

## Analiza

`/analiza` je zasebna cjelina (`src/analiza`, `src/pages/analiza.astro`) s vlastitim izgledom. Čita iste podatke kao vozni red i ništa u njima ne mijenja; ostale stranice na nju imaju samo poveznicu.

`data/naselja.json` sadrži 59 naselja: stanovnike i dob iz konačnih rezultata popisa 2013, broj iz popisa 1991. i granice sa statistika.ba, poravnate na granicu Distrikta iz OpenStreetMapa (medijan odstupanja 24 m). Datoteka se ne mijenja s feedom.

Prijedlog za vikende i praznike je u `data/vikend.json`. Vezan je uz vožnje iz trenutnog feeda; kad se vozni red promijeni, složi ga ponovno s `node scripts/vikend.ts` (poslije `npm run gtfs:build`).

## Objava

Gurni repo na GitHub i uvezi ga u Vercel; Astro prepozna sam. Build na Vercelu prvo pokuša skinuti najnoviji feed, a ako ne uspije koristi kopiju iz repoa.

Za dnevno osvježavanje napravi Deploy Hook u Vercelu (Settings → Git) i spremi ga kao secret `VERCEL_DEPLOY_HOOK` na GitHubu. Poziva ga `.github/workflows/gtfs.yml`.

## Drugi grad

Promijeni `city.config.ts`, pokreni `npm run gtfs:fetch` i prilagodi tekstove u `src/layouts/Layout.astro`.
