// Jezik i pismo. Ugrađuje se u <head> prije sadržaja, da stranica ne bljesne krivim jezikom.
// Izvor je uvijek hrvatska latinica; ostalo nastaje u pregledniku i vrijedi i za ono što komponente kasnije ispišu.
// Dio s translate="no" ili .notranslate (prijevoznik, oznake linija) ostaje kakav jest.
(() => {
  /**
   * Izrazi koji se razlikuju: hrvatski -> [bosanski, srpski]; null = isto kao u hrvatskom.
   * Svaki oblik (padež) navodi se posebno, malim slovom; veliko početno slovo se prenosi.
   * tests/jezik.test.ts pazi da se svaki izraz stvarno koristi i da ne dira nazive stanica i linija.
   */
  const WORDS = {
    'vozni red': ['red vožnje', 'red vožnje'],
    'voznog reda': ['reda vožnje', 'reda vožnje'],
    'voznom redu': ['redu vožnje', 'redu vožnje'],
    karta: ['mapa', 'mapa'],
    karte: ['mape', 'mape'],
    karti: ['mapi', 'mapi'],
    'kartu pomiči s dva prsta': ['mapu pomjeraj s dva prsta', 'mapu pomjeraj sa dva prsta'],
    prijevoznik: [null, 'prevoznik'],
    prijevoza: [null, 'prevoza'],
    'vrijedi do': [null, 'važi do'],
    'vrijedi od': [null, 'važi od'],
    'vrijedio je': [null, 'važio je'],
    'praznici i školski praznici': ['praznici i školski raspust', 'praznici i školski raspust'],
    neslužbena: ['nezvanična', 'nezvanična'],
    'zadnja stanica': ['posljednja stanica', 'posljednja stanica'],
    'popis stanica': ['spisak stanica', 'spisak stanica'],
    'popis se': ['spisak se', 'spisak se'],
    idućih: ['narednih', 'narednih'],
    ponovno: ['ponovo', 'ponovo'],
    spremi: ['sačuvaj', 'sačuvaj'],
    ispis: ['printaj', 'štampaj'],
    sustav: ['sistem', 'sistem'],
    pješice: ['pješke', 'pješke'],
    odaberi: [null, 'izaberi'],
    dopusti: ['dozvoli', 'dozvoli'],
    preglednik: [null, 'pregledač'],
    'postavkama preglednika': [null, 'podešavanjima pregledača'],
    tko: ['ko', 'ko'],
    'početni zaslon': ['početni ekran', 'početni ekran'],
    kotačić: ['točkić', 'točkić'],
  };
  /** Oznaka `sr` se izbjegava za ćirilicu: Overpass tada i u uspravnom tekstu crta rukopisna slova (т kao ш s crtom). */
  const LANGUAGES = {
    bs: { lang: 'bs', code: 'BS', words: 0 },
    hr: { lang: 'hr', code: 'HR' },
    sr: { lang: 'sr-Latn', code: 'SR', words: 1 },
    'sr-cyrl': { lang: 'bs-Cyrl', code: 'СР', words: 1, cyrillic: true },
  };

  const LETTER = 'a-zšđčćž';
  const phrase = new RegExp(`(^|[^${LETTER}])(${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})(?![${LETTER}])`, 'gi');
  const translate = (s, column) => s.replace(phrase, (all, before, w) => {
    const out = WORDS[w.toLowerCase()][column];
    if (!out) return all;
    return before + (w[0] === w[0].toLowerCase() ? out : out[0].toUpperCase() + out.slice(1));
  });

  const LAT = 'abvgdđežzijklmnoprstćufhcčš';
  const CYR = 'абвгдђежзијклмнопрстћуфхцчш';
  const letters = { nj: 'њ', lj: 'љ', 'dž': 'џ' };
  [...LAT].forEach((c, i) => { letters[c] = CYR[i]; });
  /** Rimski brojevi, mjerne jedinice i kratice koje se i u ćirilici pišu latinicom. */
  const KEEP = /^(?:[IVX]+|min|km|h|m|GTFS|CC|PDF|Ctrl)$/;
  const word = (w) => w.replace(/nj|lj|dž|./gi, (c) => {
    const out = letters[c.toLowerCase()];
    return c[0] === c[0].toLowerCase() ? out : out.toUpperCase();
  });
  // Slova zalijepljena na broj (12A) su oznake; riječi sa stranim slovima ostaju.
  const toCyrillic = (s) => s.replace(/(\d*)([a-zšđčćž]+)/gi, (all, digits, w) =>
    (digits || KEEP.test(w) || /[qwxy]/i.test(w) ? all : word(w)));

  /** Tekst u zadanom jeziku. */
  const convertTo = (id, s) => {
    const l = LANGUAGES[id];
    const t = l.words === undefined ? s : translate(s, l.words);
    return l.cyrillic ? toCyrillic(t) : t;
  };
  /** Prvi podržani jezik preglednika; `sr` bez pisma je ćirilica. */
  const detect = (preferred) => {
    for (const p of preferred) {
      const [base, ...rest] = p.toLowerCase().split('-');
      if (base === 'sr') return rest.includes('latn') ? 'sr' : 'sr-cyrl';
      if (base === 'bs' || base === 'hr') return base;
    }
    return 'hr';
  };

  const api = { id: 'hr', cyrillic: false, words: WORDS, toCyrillic, convertTo, detect, convert: (s) => convertTo(api.id, s) };
  globalThis.jezik = api;
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const SKIP = 'script, style, noscript, textarea, [translate="no"], .notranslate, .maplibregl-ctrl-attrib-inner';
  const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
  /** Što je gdje zamijenjeno, da se može vratiti. */
  const texts = new WeakMap();
  const attrs = new WeakMap();

  const text = (node) => {
    if (!/[a-zšđčćž]/i.test(node.data) || node.parentElement?.closest(SKIP)) return;
    const was = texts.get(node);
    // Parser zna nadopisati isti čvor; tada se pretvara cijeli izvorni tekst.
    const src = was && node.data.startsWith(was.out) ? was.src + node.data.slice(was.out.length) : node.data;
    const out = api.convert(src);
    if (out === src) return;
    texts.set(node, { src, out });
    if (node.data !== out) node.data = out;
  };
  const attr = (el, name) => {
    const now = el.getAttribute(name);
    if (!now || el.closest(SKIP)) return;
    const was = attrs.get(el)?.[name];
    const src = was?.out === now ? was.src : now;
    const out = api.convert(src);
    if (out === src) return;
    attrs.set(el, { ...attrs.get(el), [name]: { src, out } });
    if (now !== out) el.setAttribute(name, out);
  };
  const walk = (node, onText, onAttr) => {
    if (node.nodeType === Node.TEXT_NODE) return onText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const a of ATTRS) if (node.hasAttribute(a)) onAttr(node, a);
    for (const c of node.childNodes) walk(c, onText, onAttr);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') text(r.target);
      else if (r.type === 'attributes') attr(r.target, r.attributeName);
      else for (const n of r.addedNodes) walk(n, text, attr);
    }
    observer.takeRecords(); // vlastite izmjene
  });
  const restore = () => walk(root,
    (node) => { const t = texts.get(node); if (t && node.data === t.out) node.data = t.src; texts.delete(node); },
    (el, name) => {
      const t = attrs.get(el)?.[name];
      if (!t) return;
      if (el.getAttribute(name) === t.out) el.setAttribute(name, t.src);
      delete attrs.get(el)[name];
    });

  const picker = () => {
    const box = document.querySelector('.lang');
    if (!box) return;
    box.hidden = false;
    box.querySelector('span').textContent = LANGUAGES[api.id].code;
    box.querySelector('select').value = api.id;
  };
  const apply = (id) => {
    const changed = id !== api.id;
    if (changed) {
      observer.disconnect();
      restore();
      api.id = id;
      api.cyrillic = !!LANGUAGES[id].cyrillic;
      if (id !== 'hr') {
        walk(root, text, attr);
        observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
      }
    }
    root.lang = LANGUAGES[id].lang;
    picker();
    if (changed) dispatchEvent(new Event('jezikchange'));
  };
  const read = () => {
    try {
      const v = localStorage.getItem('jezik');
      if (v && Object.hasOwn(LANGUAGES, v)) return v;
      if (localStorage.getItem('pismo') === 'cir') return 'sr-cyrl'; // prijašnji prekidač pisma
    } catch {
      if (api.chosen) return api.id;
    }
    return detect(navigator.languages ?? [navigator.language]);
  };

  apply(read());
  addEventListener('storage', (e) => { if (e.key === 'jezik' || e.key === null) apply(read()); });
  addEventListener('pageshow', (e) => { if (e.persisted) apply(read()); });
  /** Poziva se odmah iza izbornika u zaglavlju. */
  api.ready = () => {
    picker();
    document.querySelector('.lang select').addEventListener('change', (e) => {
      api.chosen = true;
      try {
        localStorage.setItem('jezik', e.target.value);
      } catch { /* privatni način: vrijedi samo za ovu stranicu */ }
      apply(e.target.value);
    });
  };
})();
