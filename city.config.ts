// Sve što je vezano uz grad. Za drugi grad promijeni ovo i pokreni `npm run gtfs:fetch`.
export const city = {
  name: 'Brčko',
  siteName: 'Brčko busom',
  timeZone: 'Europe/Sarajevo',
  feedUrl: 'https://raw.githubusercontent.com/to0ony/gtfs-brcko-district/main/gtfs.zip',
  sourceUrl: 'https://radiobrcko.ba/wp-content/uploads/2023/01/Gradski-prevoz-red-voznje.pdf',
  /**
   * Boje po liniji; varijante (12A, 12B...) dijele boju broja. Bez unosa se koristi route_color iz feeda.
   * Sve imaju istu svjetlinu: bijeli tekst >= 4.5:1, a boja >= 3:1 prema podlozi u obje teme
   * (tests/contrast.test.ts). Susjedni brojevi imaju udaljene nijanse.
   */
  lineColors: {
    '1': '#C53F3E', '2': '#63761C', '3': '#22798D', '4': '#974FBB', '5': '#AE561D',
    '6': '#207F2D', '7': '#2075A8', '8': '#B04599', '9': '#95651C', '10': '#227D62',
    '11': '#3F69D3', '12': '#C03E6F', '13': '#7F6E1E', '14': '#217B79', '15': '#735CCF',
  } as Record<string, string>,
};
