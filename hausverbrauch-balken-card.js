/*
 * Hausverbrauch-Balken-Karte für Home Assistant  –  v1.2.1
 * Zeigt den gesamten Stromverbrauch des Hauses als Säulen: je Tag (14 Tage, 1 Monat) oder je Monat
 * (3, 6, 12 Monate) – umschaltbar oben rechts, die Auswahl wird gemerkt. Jede Säule ist nach Herkunft
 * aufgeteilt: Netz (unten), PV, Akku. Der laufende Tag bzw. Monat ist heller. Ein Tipp auf eine Säule
 * zeigt Datum, Summe und Aufteilung; unter „Werte“ stehen alle Zahlen als Tabelle.
 *
 * Verbrauch je Zeitraum = Summe der plus-Zähler − Summe der minus-Zähler aus der Langzeitstatistik.
 * Aufteilung je Abschnitt: Netz = Netzbezug (höchstens der Verbrauch), Akku = Akku-Entladung (höchstens
 * der Rest), PV = was übrig bleibt – wie bei „Hausverbrauch heute“. Ohne plus/minus nimmt die Karte die
 * Energie-Einstellungen: Netzbezug − Einspeisung + Solar + Akku-Entladung − Akku-Ladung.
 * Zählersprünge (negativ oder mehr als 500 kWh am Tag bzw. 50 kWh je Stunde) gelten als Fehler und zählen nicht.
 * Der heutige Tag kommt aus den Stundenwerten plus den 5-Minuten-Werten der laufenden Stunde.
 *
 * Geräte ausklammern: Für jedes Gerät unter „geraete“ gibt es oben einen Schalter „ohne …“. Ist er an, zählt
 * sein Verbrauch nicht mit. Es bekommt dabei den Strommix des Hauses in derselben Stunde (Tagesansicht) bzw.
 * am selben Tag (Monatsansicht, deshalb dort „≈“). Die Schalter merkt sich jedes Gerät.
 *
 * type: custom:hausverbrauch-balken-card
 * title: Hausverbrauch                  # optional, Überschrift
 * range: 14d                            # optional, Start-Zeitraum: 1–90 Tage (14d) oder 1–36 Monate (3m)
 * ranges: [14d, 1m, 3m, 6m, 12m]        # optional, Zeiträume im Umschalter; [] blendet ihn aus
 * plus:                                 # optional, Zähler (Langzeitstatistik), die addiert werden
 *   - sensor.netzbezug
 *   - sensor.wechselrichter_energie
 * minus:                                # optional, Zähler, die abgezogen werden
 *   - sensor.einspeisung
 * netz: [sensor.netzbezug]              # optional, Netzbezug für die Aufteilung (ohne: eine Farbe)
 * akku: [sensor.akku_entladung]         # optional, Akku-Entladung für die Aufteilung
 * split: true                           # optional, false = nicht aufteilen
 * colors: { netz: "#488fc2", pv: "#ff9800", akku: "#4db6ac" }   # optional
 * color: "#6250d6"                      # optional, Säulenfarbe ohne Aufteilung
 * geraete:                              # optional, Geräte zum Ausklammern (Schalter „ohne …“)
 *   - name: Auto laden
 *     entity: sensor.wallbox_energie    # ein Zähler oder eine Liste
 *
 * Bis 2 Monate zeigt die Karte Tage (1 Monat = 30 Tage), ab 3 Monaten Monate.
 *
 * Quelle: https://github.com/bryce2071/hausverbrauch-balken-card (MIT-Lizenz)
 */
(() => {
  const TAG = "hausverbrauch-balken-card";
  const EDITOR_TAG = `${TAG}-editor`;
  const VERSION = "1.2.1";
  if (customElements.get(TAG)) return;

  const DEFAULT_RANGE = "14d";
  const DEFAULT_RANGES = ["14d", "1m", "3m", "6m", "12m"];
  const RANGE_CHOICES = ["7d", "14d", "1m", "2m", "3m", "6m", "12m", "24m"];
  const STEP_MS = 5 * 60 * 1000; // Home Assistant schreibt alle 5 Minuten Statistiken
  const STORE_KEY = `${TAG}:range`;
  const STORE_OFF = `${TAG}:ohne`;
  const LIMIT = { day: 500, hour: 50, "5minute": 50 }; // kWh je Zähler und Abschnitt – mehr gilt als Zählerfehler
  const PAD_TOP = 24; // Platz über der höchsten Säule für ihren Wert
  const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const MONTHS_LONG = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];
  const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const NBSP = String.fromCharCode(160); // geschütztes Leerzeichen
  const NL = String.fromCharCode(10); // Zeilenumbruch
  const PARTS = [
    ["netz", "Netz"],
    ["pv", "PV"],
    ["akku", "Akku"],
  ];

  const STYLE = `
    :host {
      display: block;
      --hvb-bar: var(--hausverbrauch-balken-color, #6250d6);
      --hvb-grid: var(--divider-color, rgba(127, 127, 127, 0.25));
      --hvb-base: rgba(127, 127, 127, 0.45);
      --hvb-wash: rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.06);
      --hvb-netz: var(--hausverbrauch-netz-color, #488fc2);
      --hvb-pv: var(--hausverbrauch-pv-color, #ff9800);
      --hvb-akku: var(--hausverbrauch-akku-color, #4db6ac);
      --gutter: 34px;
    }
    :host([dark]) { --hvb-bar: var(--hausverbrauch-balken-color, #9085e9); }
    [hidden] { display: none !important; }
    ha-card { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
    .head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 4px 12px; padding: 16px 16px 2px; }
    .titles { flex: 1 1 170px; min-width: 0; }
    .title {
      font-family: var(--ha-card-header-font-family, inherit);
      font-size: var(--ha-card-header-font-size, 24px);
      color: var(--ha-card-header-color, var(--primary-text-color));
      line-height: 32px; letter-spacing: -0.012em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .sub { color: var(--secondary-text-color); font-size: 13px; line-height: 18px; }
    .controls { flex: none; max-width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 4px; }
    .toggle {
      flex: none; display: inline-flex; overflow: hidden;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); border-radius: 999px;
    }
    .chip {
      font: inherit; font-size: 12px; line-height: 16px; padding: 4px 11px; margin: 0; cursor: pointer; white-space: nowrap;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); border-radius: 999px;
      background: none; color: var(--secondary-text-color);
    }
    .chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
    .toggle button {
      font: inherit; font-size: 12px; line-height: 16px; min-width: 34px; padding: 4px 9px; margin: 0; border: 0;
      background: none; color: var(--secondary-text-color); cursor: pointer; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .toggle button + button { border-left: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3)); }
    .toggle button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
    .content { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; padding: 10px 16px 12px; }
    .msg { color: var(--secondary-text-color); font-size: 14px; padding: 6px 0 4px; }
    .msg.error { color: var(--error-color, #db4437); }
    .chart { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; transition: opacity 0.2s ease; }
    .chart.loading { opacity: 0.5; }
    .plotwrap {
      flex: 1 1 auto; display: grid; grid-template-columns: var(--gutter) minmax(0, 1fr);
      height: var(--hausverbrauch-balken-height, 200px); min-height: 140px;
    }
    .yaxis { position: relative; }
    .unit, .yticks span {
      position: absolute; right: 6px; color: var(--secondary-text-color);
      font-size: 11px; line-height: 14px; white-space: nowrap; font-variant-numeric: tabular-nums;
    }
    .unit { top: 0; }
    .yticks { position: absolute; left: 0; right: 0; top: ${PAD_TOP}px; bottom: 0; }
    .yticks span { transform: translateY(50%); }
    .plot { position: relative; outline: none; border-radius: 4px; }
    .plot:focus-visible { box-shadow: 0 0 0 2px var(--primary-color); }
    .inner { position: absolute; left: 0; right: 0; top: ${PAD_TOP}px; bottom: 0; }
    .gl { position: absolute; left: 0; right: 0; height: 1px; background: var(--hvb-grid); }
    .gl.base { background: var(--hvb-base); }
    .bars { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(var(--n, 1), minmax(0, 1fr)); }
    .slot { position: relative; height: 100%; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .slot.none { cursor: default; }
    .slot::before {
      content: ""; position: absolute; left: 1px; right: 1px; top: -${PAD_TOP}px; bottom: 0;
      border-radius: 4px; background: transparent; transition: background 0.15s ease;
    }
    .slot.on::before { background: var(--hvb-wash); }
    .bar {
      position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
      width: min(24px, calc(100% - 2px)); height: 0; border-radius: 4px 4px 0 0; overflow: hidden;
      display: flex; flex-direction: column-reverse; gap: 2px;
      background: var(--hvb-bar); transition: height 0.5s ease, filter 0.15s ease, opacity 0.15s ease;
    }
    .bar.split { background: none; }
    .seg { display: none; flex: 0 1 0px; min-height: 0; }
    .bar.split .seg.show { display: block; }
    .netz { background: var(--hvb-netz); }
    .pv { background: var(--hvb-pv); }
    .akku { background: var(--hvb-akku); }
    .slot.cur .bar { opacity: 0.5; }
    .slot.on .bar { filter: brightness(1.15) saturate(1.1); }
    .slot.cur.on .bar { opacity: 0.7; }
    .lbl {
      position: absolute; left: 50%; transform: translateX(-50%); pointer-events: none; padding: 0 2px; border-radius: 3px;
      background: var(--card-background-color, var(--ha-card-background, #fff));
      color: var(--secondary-text-color); font-size: 11px; line-height: 14px; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .lbl[data-align="l"] { left: 0; transform: none; }
    .lbl[data-align="r"] { left: auto; right: 0; transform: none; }
    .tip {
      position: absolute; z-index: 2; pointer-events: none; padding: 6px 10px; border-radius: 8px;
      background: var(--card-background-color, var(--ha-card-background, #fff));
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); white-space: nowrap;
    }
    .tv { color: var(--primary-text-color); font-size: 14px; font-weight: 600; line-height: 18px; font-variant-numeric: tabular-nums; }
    .tl { color: var(--secondary-text-color); font-size: 12px; line-height: 16px; }
    .tp {
      display: grid; grid-template-columns: auto auto auto auto; justify-content: start; column-gap: 8px; align-items: center;
      margin-top: 4px; font-size: 12px; line-height: 17px; font-variant-numeric: tabular-nums;
    }
    .key { display: inline-block; width: 10px; height: 3px; border-radius: 2px; }
    .tp .tn, .tp .tq { color: var(--secondary-text-color); }
    .tp .tk { color: var(--primary-text-color); text-align: right; }
    .tp .tq { text-align: right; }
    .tx { margin-top: 3px; color: var(--secondary-text-color); font-size: 12px; line-height: 16px; white-space: pre-line; }
    .xaxis {
      display: grid; grid-template-columns: repeat(var(--n, 1), minmax(0, 1fr));
      margin: 5px 0 0 var(--gutter); min-height: 28px;
    }
    .xl {
      display: flex; flex-direction: column; align-items: center; min-width: 0;
      color: var(--secondary-text-color); font-size: 11px; line-height: 14px; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .xl .b { font-size: 10px; line-height: 13px; opacity: 0.85; }
    .foot {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; margin-top: 6px;
      color: var(--secondary-text-color); font-size: 12px; line-height: 16px;
    }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
    .lg { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
    .values { margin-top: 6px; color: var(--secondary-text-color); font-size: 12px; line-height: 16px; }
    .values summary { cursor: pointer; }
    .values table { border-collapse: collapse; margin-top: 6px; font-variant-numeric: tabular-nums; }
    .values th { font-weight: 500; text-align: right; padding: 2px 0 2px 12px; white-space: nowrap; }
    .values th .key { width: 8px; margin-right: 4px; vertical-align: middle; }
    .values td { padding: 2px 0 2px 12px; text-align: right; color: var(--primary-text-color); white-space: nowrap; }
    .values th:first-child, .values td:first-child { text-align: left; padding-left: 0; }
    .values td:first-child { color: var(--secondary-text-color); }
    .values td.sum { font-weight: 500; }
    .values tr.cur td { opacity: 0.75; }
    .stamp { margin-left: auto; white-space: nowrap; }
    .stamp.error { color: var(--error-color, #db4437); }
    .live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const toMs = (v) => (typeof v === "number" ? v : Date.parse(v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };
  const startOfMonth = (d) => {
    const x = startOfDay(d);
    x.setDate(1);
    return x;
  };
  const addMonths = (d, n) => {
    const x = startOfMonth(d);
    x.setMonth(x.getMonth() + n);
    return x;
  };
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const ym = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const isStatId = (s) => typeof s === "string" && /^[a-z0-9_]+[.:][a-z0-9_]+$/i.test(s.trim());

  // "14d" → 14 Tagessäulen, "1m" → 30 Tagessäulen, "3m" → 3 Monatssäulen
  const parseRange = (value) => {
    const m = /^\s*(\d{1,2})\s*([dmtDMT])\s*$/.exec(String(value));
    if (!m) return null;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if ((unit === "d" || unit === "t") && n >= 1 && n <= 90) {
      return { key: `${n}d`, unit: "day", n, short: `${n} T`, long: n === 1 ? "1 Tag" : `${n} Tage` };
    }
    if (unit === "m" && n >= 1 && n <= 36) {
      const long = n === 1 ? "1 Monat" : `${n} Monate`;
      return n < 3
        ? { key: `${n}m`, unit: "day", n: n * 30, short: `${n} M`, long }
        : { key: `${n}m`, unit: "month", n, short: `${n} M`, long };
    }
    return null;
  };
  const spanDays = (r) => (r.unit === "day" ? r.n : r.n * 30.44);
  const cleanRanges = (list) => {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((x) => {
      const p = parseRange(x);
      if (p && !out.some((o) => o.key === p.key)) out.push(p);
    });
    return out.sort((a, b) => spanDays(a) - spanDays(b));
  };

  // Je Abschnitt: Haus = plus − minus (nie unter 0), Netz = Netzbezug (höchstens Haus),
  // Akku = Akku-Entladung (höchstens der Rest), PV = was übrig bleibt. Zählersprünge zählen nicht.
  // Ergebnis: Map start(ms) → { haus, netz, pv, akku } – nur Abschnitte mit Werten der plus-Zähler
  const usage = (res, src, period, devs = []) => {
    const limit = LIMIT[period];
    const acc = new Map();
    const add = (ids, key) =>
      ids.forEach((id) =>
        ((res && res[id]) || []).forEach((r) => {
          const c = Number(r.change);
          if (r.change === null || r.change === undefined || !Number.isFinite(c)) return;
          const s = toMs(r.start);
          let e = acc.get(s);
          if (!e) {
            e = { p: 0, m: 0, n: 0, a: 0, has: false };
            acc.set(s, e);
          }
          e[key] += c >= 0 && c <= limit ? c : 0;
          if (key === "p") e.has = true;
        }),
      );
    add(src.plus, "p");
    add(src.minus, "m");
    add(src.netz, "n");
    add(src.akku, "a");
    // Geräte zum Ausklammern: Verbrauch je Gerät und Abschnitt
    devs.forEach((d) =>
      d.ids.forEach((id) =>
        ((res && res[id]) || []).forEach((r) => {
          const c = Number(r.change);
          const e = acc.get(toMs(r.start));
          if (!e || r.change === null || r.change === undefined || !Number.isFinite(c)) return;
          if (!e.dev) e.dev = {};
          e.dev[d.name] = (e.dev[d.name] || 0) + (c >= 0 && c <= limit ? c : 0);
        }),
      ),
    );
    const out = new Map();
    acc.forEach((e, s) => {
      if (!e.has) return;
      const haus = Math.max(0, e.p - e.m);
      const netz = Math.min(e.n, haus);
      const akku = Math.max(0, Math.min(e.a, haus - netz));
      out.set(s, { haus, netz, akku, pv: Math.max(0, haus - netz - akku), dev: e.dev || {} });
    });
    return out;
  };
  // Ohne die ausgeklammerten Geräte: Sie bekommen den Strommix des Hauses im selben Abschnitt
  // (Netz, PV und Akku schrumpfen anteilig); höchstens so viel, wie das Haus im Abschnitt verbraucht hat.
  const without = (u, names) => {
    if (!names.length) return { haus: u.haus, netz: u.netz, pv: u.pv, akku: u.akku, ohne: 0 };
    const d = Math.min(u.haus, names.reduce((a, n) => a + ((u.dev && u.dev[n]) || 0), 0));
    const f = u.haus > 0 ? (u.haus - d) / u.haus : 0;
    return { haus: u.haus - d, netz: u.netz * f, pv: u.pv * f, akku: u.akku * f, ohne: d };
  };
  const addUsage = (a, b) =>
    a
      ? { haus: a.haus + b.haus, netz: a.netz + b.netz, pv: a.pv + b.pv, akku: a.akku + b.akku, ohne: (a.ohne || 0) + (b.ohne || 0) }
      : { haus: b.haus, netz: b.netz, pv: b.pv, akku: b.akku, ohne: b.ohne || 0 };
  // Prozente, die zusammen 100 ergeben (größter Rest bekommt die Rundungsdifferenz)
  const percents = (values) => {
    const total = values.reduce((a, v) => a + v, 0);
    if (!(total > 0)) return values.map(() => 0);
    const raw = values.map((v) => (v * 100) / total);
    const out = raw.map((v) => Math.floor(v));
    let rest = 100 - out.reduce((a, v) => a + v, 0);
    raw
      .map((v, i) => [v - Math.floor(v), i])
      .sort((x, y) => y[0] - x[0])
      .forEach(([, i]) => {
        if (rest > 0) {
          out[i] += 1;
          rest -= 1;
        }
      });
    return out;
  };
  const lastEnd = (res, from) => {
    let t = from;
    Object.values(res || {}).forEach((rows) =>
      (rows || []).forEach((r) => {
        t = Math.max(t, toMs(r.end));
      }),
    );
    return t;
  };

  // Achse mit runden Schritten (1, 2, 2,5, 5 × 10ⁿ), etwa vier Abschnitte
  const niceScale = (peak) => {
    if (!(peak > 0)) return { max: 4, step: 1 };
    const rough = peak / 4;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const n = rough / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return { max: Math.ceil(peak / step - 1e-9) * step, step };
  };
  const decimalsOf = (x) => {
    for (let d = 0; d < 4; d += 1) if (Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) < 1e-6) return d;
    return 4;
  };

  class HausverbrauchBalkenCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._active = -1;
      this._onVisible = () => {
        if (document.visibilityState === "visible" && this._connected && this._isStale()) this._refresh();
      };
      this._ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this._layout());
    }

    setConfig(config) {
      const cfg = { ...(config || {}) };
      const range = parseRange(cfg.range === undefined ? DEFAULT_RANGE : cfg.range);
      if (!range) throw new Error("'range' muss z. B. 14d (1–90 Tage) oder 3m (1–36 Monate) sein.");
      const raw = cfg.ranges === undefined ? DEFAULT_RANGES : cfg.ranges;
      if (!Array.isArray(raw)) throw new Error("'ranges' muss eine Liste sein, z. B. [14d, 1m, 3m, 6m, 12m].");
      raw.forEach((r) => {
        if (!parseRange(r)) throw new Error(`Unbekannter Zeitraum '${r}' – erlaubt sind z. B. 14d oder 3m.`);
      });
      const ranges = cleanRanges(raw);
      if (ranges.length && !ranges.some((r) => r.key === range.key)) {
        ranges.push(range);
        ranges.sort((a, b) => spanDays(a) - spanDays(b));
      }
      const ids = (value, name) => {
        if (value === undefined || value === null || value === "") return [];
        const list = Array.isArray(value) ? value : [value];
        list.forEach((id) => {
          if (!isStatId(id)) throw new Error(`'${name}' braucht Statistik-IDs wie sensor.netzbezug – '${id}' passt nicht.`);
        });
        return [...new Set(list.map((id) => id.trim()))];
      };
      const plus = ids(cfg.plus, "plus");
      const minus = ids(cfg.minus, "minus");
      const netz = ids(cfg.netz, "netz");
      const akku = ids(cfg.akku, "akku");
      if (!plus.length && minus.length) throw new Error("Zu 'minus' gehört mindestens ein Zähler unter 'plus'.");
      if (!plus.length && (netz.length || akku.length)) throw new Error("'netz' und 'akku' gehen nur zusammen mit 'plus'.");
      if (cfg.colors !== undefined && (typeof cfg.colors !== "object" || cfg.colors === null || Array.isArray(cfg.colors))) {
        throw new Error("'colors' muss so aussehen: { netz: '#488fc2', pv: '#ff9800', akku: '#4db6ac' }.");
      }
      const colors = cfg.colors || {};
      if (cfg.geraete !== undefined && !Array.isArray(cfg.geraete)) {
        throw new Error("'geraete' muss eine Liste sein, z. B. - name: Auto laden / entity: sensor.wallbox_energie");
      }
      const geraete = [];
      (cfg.geraete || []).forEach((g, i) => {
        const name = g && typeof g.name === "string" ? g.name.trim() : "";
        if (!name) throw new Error(`Gerät ${i + 1} unter 'geraete' braucht einen 'name'.`);
        const devIds = ids(g.entity, `geraete → ${name} → entity`);
        if (!devIds.length) throw new Error(`Gerät „${name}“ braucht unter 'entity' mindestens einen Zähler.`);
        if (geraete.some((x) => x.name === name)) throw new Error(`Das Gerät „${name}“ steht doppelt unter 'geraete'.`);
        geraete.push({ name, ids: devIds });
      });
      this._config = {
        ...cfg,
        title: cfg.title === undefined ? "Hausverbrauch" : cfg.title,
        range,
        ranges,
        plus,
        minus,
        netz,
        akku,
        split: cfg.split !== false,
        color: typeof cfg.color === "string" && cfg.color.trim() ? cfg.color.trim() : null,
        geraete,
      };
      if (this._config.color) this.style.setProperty("--hausverbrauch-balken-color", this._config.color);
      else this.style.removeProperty("--hausverbrauch-balken-color");
      PARTS.forEach(([k]) => {
        const v = typeof colors[k] === "string" ? colors[k].trim() : "";
        if (v) this.style.setProperty(`--hausverbrauch-${k}-color`, v);
        else this.style.removeProperty(`--hausverbrauch-${k}-color`);
      });
      this._range = this._storedRange() || range;
      this._off = this._storedOff();
      this._built = false;
      this._active = -1;
      this._past = null;
      this._pastKey = null;
      this._pastFrom = Infinity;
      this._sources = null;
      this._hours = null;
      this._hoursKey = null;
      this._hoursFrom = Infinity;
      this._data = null;
      this._loadedAt = 0;
      if (this._hass) {
        this._render();
        this._kick();
      }
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      const dark = !!(hass && hass.themes && hass.themes.darkMode);
      if (dark !== this.hasAttribute("dark")) this.toggleAttribute("dark", dark);
      if (first && this._config) {
        this._render();
        this._kick();
      }
    }

    connectedCallback() {
      this._connected = true;
      document.addEventListener("visibilitychange", this._onVisible);
      if (this._ro && this._plotEl) this._ro.observe(this._plotEl);
      this._kick();
    }

    disconnectedCallback() {
      this._connected = false;
      document.removeEventListener("visibilitychange", this._onVisible);
      if (this._ro) this._ro.disconnect();
      clearTimeout(this._timer);
      this._timer = null;
    }

    getCardSize() {
      return 6;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6 };
    }

    static getStubConfig() {
      return { title: "Hausverbrauch", range: DEFAULT_RANGE, ranges: DEFAULT_RANGES.slice() };
    }

    static async getConfigElement() {
      await loadHaForm();
      return document.createElement(EDITOR_TAG);
    }

    // ---------- Daten ----------

    // Die Auswahl im Umschalter gilt nur, solange der Start-Zeitraum derselbe ist
    _storedRange() {
      const opts = this._config.ranges;
      if (opts.length < 2) return null;
      try {
        const s = JSON.parse(window.localStorage.getItem(STORE_KEY) || "null");
        return (s && s.base === this._config.range.key && opts.find((r) => r.key === s.range)) || null;
      } catch (e) {
        return null;
      }
    }

    // Ausgeklammerte Geräte (Namen), nur solche, die es in der Karte noch gibt
    _storedOff() {
      const names = this._config.geraete.map((g) => g.name);
      try {
        const s = JSON.parse(window.localStorage.getItem(STORE_OFF) || "[]");
        return new Set((Array.isArray(s) ? s : []).filter((n) => names.includes(n)));
      } catch (e) {
        return new Set();
      }
    }

    _isStale() {
      return !this._loadedAt || Date.now() - this._loadedAt > 2 * 60 * 1000;
    }

    _kick() {
      if (!this._hass || !this._config || !this._connected || this._loading) return;
      if (this._isStale() || !this._data) this._refresh();
      else this._schedule();
    }

    _schedule() {
      clearTimeout(this._timer);
      this._timer = null;
      if (!this._connected) return;
      const now = Date.now();
      // kurz nach jedem 5-Minuten-Raster, dann sind die neuen Statistiken geschrieben
      const next = Math.floor(now / STEP_MS) * STEP_MS + STEP_MS + 20 * 1000;
      this._timer = setTimeout(() => {
        this._timer = null;
        this._refresh();
      }, Math.max(10 * 1000, next - now));
    }

    async _refresh() {
      if (this._loading) {
        this._again = true;
        return;
      }
      this._loading = true;
      clearTimeout(this._timer);
      try {
        await this._load();
        this._error = null;
      } catch (err) {
        this._error = (err && (err.message || err.code)) || String(err);
        console.warn(`${TAG}:`, err);
      }
      this._loading = false;
      this._loadedAt = Date.now();
      this._render();
      if (this._again) {
        this._again = false;
        this._refresh();
        return;
      }
      this._schedule();
    }

    _stats(start, end, ids, period) {
      if (!ids.length || end <= start) return Promise.resolve({});
      return this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: ids,
        period,
        units: { energy: "kWh" },
        types: ["change"],
      });
    }

    // Ohne plus/minus: Netz, Solar und Akku aus den Energie-Einstellungen
    async _sourcesFor() {
      const cfg = this._config;
      if (cfg.plus.length) return { plus: cfg.plus, minus: cfg.minus, netz: cfg.netz, akku: cfg.akku };
      if (this._sources && Date.now() - this._sourcesAt < 30 * 60 * 1000) return this._sources;
      const prefs = await this._hass.callWS({ type: "energy/get_prefs" });
      const plus = [];
      const minus = [];
      const netz = [];
      const akku = [];
      const push = (list, id) => {
        if (id && !list.includes(id)) list.push(id);
      };
      ((prefs && prefs.energy_sources) || []).forEach((s) => {
        if (s.type === "grid") {
          [s.stat_energy_from, ...(s.flow_from || []).map((f) => f.stat_energy_from)].forEach((id) => {
            push(plus, id);
            push(netz, id);
          });
          [s.stat_energy_to, ...(s.flow_to || []).map((f) => f.stat_energy_to)].forEach((id) => push(minus, id));
        } else if (s.type === "solar") {
          push(plus, s.stat_energy_from);
        } else if (s.type === "battery") {
          push(plus, s.stat_energy_from);
          push(akku, s.stat_energy_from);
          push(minus, s.stat_energy_to);
        }
      });
      this._sources = { plus, minus, netz, akku };
      this._sourcesAt = Date.now();
      return this._sources;
    }

    async _load() {
      const src = await this._sourcesFor();
      if (!src.plus.length) {
        throw new Error("keine Zähler – bitte 'plus' angeben oder Netz und Solar in den Energie-Einstellungen eintragen");
      }
      const devs = this._config.geraete;
      const off = devs.map((g) => g.name).filter((n) => this._off.has(n));
      const ids = [...new Set([...src.plus, ...src.minus, ...src.netz, ...src.akku, ...devs.flatMap((g) => g.ids)])];
      const split = this._config.split && src.netz.length > 0;
      const range = this._range;
      const now = new Date();
      const today = startOfDay(now);
      const from = range.unit === "day" ? addDays(today, 1 - range.n) : addMonths(today, 1 - range.n);

      // Ganze Tage vor heute: einmal am Tag laden – kürzere Zeiträume nutzen dieselben Daten
      const key = [today.getTime(), src.plus, src.minus, src.netz, src.akku, ids].map(String).join("|");
      if (this._pastKey !== key || this._pastFrom > from.getTime()) {
        const res = (await this._stats(from, today, ids, "day")) || {};
        const past = new Map();
        usage(res, src, "day", devs).forEach((v, s) => {
          if (s < today.getTime()) past.set(ymd(new Date(s)), v);
        });
        this._past = past;
        this._pastKey = key;
        this._pastFrom = from.getTime();
      }

      // Tagesansicht mit ausgeklammerten Geräten: Stundenwerte, damit das Gerät den Strommix seiner Stunde bekommt
      const hourly = range.unit === "day" && off.length > 0;
      if (hourly && (this._hoursKey !== key || this._hoursFrom > from.getTime())) {
        const res = (await this._stats(from, today, ids, "hour")) || {};
        const byDay = new Map();
        usage(res, src, "hour", devs).forEach((v, s) => {
          if (s >= today.getTime()) return;
          const k = ymd(new Date(s));
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k).push(v);
        });
        this._hours = byDay;
        this._hoursKey = key;
        this._hoursFrom = from.getTime();
      }

      // Heute: volle Stunden aus der Langzeitstatistik, dazu die laufende Stunde aus der 5-Minuten-Statistik
      const todayHours = (await this._stats(today, now, ids, "hour")) || {};
      const covered = lastEnd(todayHours, today.getTime());
      const recent =
        covered < now.getTime() - 60 * 1000 ? (await this._stats(new Date(covered), now, ids, "5minute")) || {} : {};
      let todayUse = null;
      [usage(todayHours, src, "hour", devs), usage(recent, src, "5minute", devs)].forEach((m) =>
        m.forEach((v) => {
          todayUse = addUsage(todayUse, without(v, off));
        }),
      );
      const cutoff = new Date(Math.min(lastEnd(recent, covered), now.getTime()));

      // Ein Tag aus der Vergangenheit: stundengenau, wenn Stundenwerte da sind, sonst mit dem Mix des ganzen Tages
      const pastDay = (k) => {
        const day = this._past.get(k);
        if (!day) return null;
        if (!off.length) return { ...without(day, off), approx: false };
        const hours = hourly && this._hours ? this._hours.get(k) : null;
        if (hours && hours.length) {
          let u = null;
          hours.forEach((h) => {
            u = addUsage(u, without(h, off));
          });
          return { ...u, approx: false };
        }
        const u = without(day, off);
        return { ...u, approx: u.ohne > 0 };
      };
      const bar = (date, u, current) => ({
        date,
        current,
        value: u ? u.haus : null,
        parts: split && u ? { netz: u.netz, pv: u.pv, akku: u.akku } : null,
        ohne: u ? u.ohne || 0 : 0,
        approx: !!(u && u.approx),
      });
      const bars = [];
      if (range.unit === "day") {
        for (let i = 0; i < range.n; i += 1) {
          const d = addDays(from, i);
          const k = ymd(d);
          const current = k === ymd(today);
          bars.push(bar(d, current ? todayUse : pastDay(k), current));
        }
      } else {
        const sums = new Map();
        this._past.forEach((v, day) => {
          const m = day.slice(0, 7);
          const u = pastDay(day);
          const prev = sums.get(m);
          sums.set(m, { ...addUsage(prev, u), approx: !!((prev && prev.approx) || u.approx) });
        });
        for (let i = 0; i < range.n; i += 1) {
          const d = addMonths(from, i);
          const k = ym(d);
          const current = k === ym(today);
          let u = sums.get(k) || null;
          if (current && todayUse) u = { ...addUsage(u, todayUse), approx: !!(u && u.approx) };
          bars.push(bar(d, u, current));
        }
      }
      this._data = { range, bars, from, today, cutoff, split, off };
    }

    // ---------- Darstellung ----------

    _numberLocale() {
      const loc = (this._hass && this._hass.locale) || {};
      switch (loc.number_format) {
        case "comma_decimal":
          return ["en-US", "en"];
        case "decimal_comma":
          return ["de", "es", "it"];
        case "space_comma":
          return ["fr", "sv", "cs"];
        case "system":
          return undefined;
        default:
          return loc.language || (this._hass && this._hass.language) || "de";
      }
    }

    _fmt(value, decimals) {
      try {
        return new Intl.NumberFormat(this._numberLocale(), {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(value);
      } catch (e) {
        return value.toFixed(decimals);
      }
    }

    _kwh(v) {
      return this._fmt(v, Math.abs(v) >= 100 ? 0 : 1);
    }

    _time(date) {
      try {
        const lang = (this._hass.locale && this._hass.locale.language) || this._hass.language || "de";
        return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(date);
      } catch (e) {
        return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
      }
    }

    // Tooltip: „Sa, 21.11.2026“, „Heute bis 10:25“, „Oktober 2026“
    _barTitle(b) {
      const d = b.date;
      if (this._data.range.unit === "day") {
        if (b.current) return `Heute bis ${this._time(this._data.cutoff)}`;
        return `${WEEKDAYS[d.getDay()]}, ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
      }
      const name = `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
      return b.current ? `${name} bis heute ${this._time(this._data.cutoff)}` : name;
    }

    // Tabelle: „Sa 21.11.“, „Heute“, „Okt 2026“
    _barName(b) {
      const d = b.date;
      if (this._data.range.unit === "day") {
        return b.current ? "Heute" : `${WEEKDAYS[d.getDay()]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`;
      }
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }

    // „Netz 54,9 · PV 8,4 · Akku 3,3 kWh“
    _partsText(parts) {
      return `${PARTS.map(([k, name]) => `${name} ${this._kwh(parts[k])}`).join(" · ")} kWh`;
    }

    _rangeText() {
      const { from, today, range } = this._data;
      if (range.unit === "day") {
        const a = `${pad2(from.getDate())}.${pad2(from.getMonth() + 1)}.`;
        const b = `${pad2(today.getDate())}.${pad2(today.getMonth() + 1)}.${today.getFullYear()}`;
        return from.getFullYear() === today.getFullYear() ? `${a} – ${b}` : `${a}${from.getFullYear()} – ${b}`;
      }
      const a = MONTHS[from.getMonth()];
      const b = `${MONTHS[today.getMonth()]} ${today.getFullYear()}`;
      if (range.n === 1) return b;
      return from.getFullYear() === today.getFullYear() ? `${a} – ${b}` : `${a} ${from.getFullYear()} – ${b}`;
    }

    _textW(text, strong) {
      if (this._ctx === undefined) {
        try {
          this._ctx = document.createElement("canvas").getContext("2d");
        } catch (e) {
          this._ctx = null;
        }
      }
      if (!this._ctx) return String(text).length * 6.4;
      const family = getComputedStyle(this).fontFamily || "Roboto, sans-serif";
      this._ctx.font = `${strong ? 500 : 400} 11px ${family}`;
      return this._ctx.measureText(String(text)).width;
    }

    _build() {
      const cfg = this._config;
      const toggle =
        cfg.ranges.length > 1
          ? `<div class="toggle" role="group" aria-label="Zeitraum">${cfg.ranges
              .map((r) => `<button type="button" data-range="${r.key}" aria-label="${r.long}" title="${r.long}">${r.short}</button>`)
              .join("")}</div>`
          : "";
      const chips = cfg.geraete
        .map(
          (g, i) =>
            `<button type="button" class="chip" data-dev="${i}" aria-pressed="false" title="${esc(`Verbrauch ohne ${g.name} zeigen`)}">ohne ${esc(g.name)}</button>`,
        )
        .join("");
      const controls = toggle || chips ? `<div class="controls">${chips}${toggle}</div>` : "";
      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <ha-card>
          <div class="head">
            <div class="titles">
              ${cfg.title ? `<div class="title">${esc(cfg.title)}</div>` : ""}
              <div class="sub"></div>
            </div>
            ${controls}
          </div>
          <div class="content">
            <div class="msg"></div>
            <div class="chart" hidden>
              <div class="plotwrap">
                <div class="yaxis"><span class="unit">kWh</span><div class="yticks"></div></div>
                <div class="plot" tabindex="0" role="group">
                  <div class="inner"><div class="grid"></div><div class="bars"></div></div>
                  <div class="tip" hidden><div class="tv"></div><div class="tl"></div><div class="tp"></div><div class="tx"></div></div>
                </div>
              </div>
              <div class="xaxis"></div>
              <div class="foot">
                <div class="legend"></div>
                <span class="stamp"></span>
              </div>
              <details class="values"><summary>Werte</summary><table><thead></thead><tbody></tbody></table></details>
              <div class="live" aria-live="polite"></div>
            </div>
          </div>
        </ha-card>`;
      const root = this.shadowRoot;
      root.querySelectorAll(".toggle button").forEach((b) => {
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const r = this._config.ranges.find((x) => x.key === b.dataset.range);
          if (!r || r.key === this._range.key) return;
          this._range = r;
          this._active = -1;
          try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify({ range: r.key, base: this._config.range.key }));
          } catch (e) {
            /* ohne Speicher gilt die Auswahl bis zum Neuladen */
          }
          this._render();
          this._refresh();
        });
      });

      root.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const name = this._config.geraete[Number(chip.dataset.dev)].name;
          if (this._off.has(name)) this._off.delete(name);
          else this._off.add(name);
          try {
            window.localStorage.setItem(STORE_OFF, JSON.stringify([...this._off]));
          } catch (e) {
            /* ohne Speicher gilt die Auswahl bis zum Neuladen */
          }
          this._render();
          this._refresh();
        });
      });

      const plot = root.querySelector(".plot");
      const bars = root.querySelector(".bars");
      bars.addEventListener("pointerdown", (ev) => {
        this._pointer = ev.pointerType;
      });
      bars.addEventListener("pointermove", (ev) => {
        if (ev.pointerType !== "mouse") return;
        const slot = ev.target.closest(".slot");
        if (slot && !slot.classList.contains("none")) this._setActive(Number(slot.dataset.i));
      });
      bars.addEventListener("pointerleave", (ev) => {
        if (ev.pointerType === "mouse") this._setActive(-1);
      });
      bars.addEventListener("click", (ev) => {
        const slot = ev.target.closest(".slot");
        if (!slot || this._pointer === "mouse") return;
        const i = Number(slot.dataset.i);
        this._setActive(this._active === i || slot.classList.contains("none") ? -1 : i);
      });
      plot.addEventListener("keydown", (ev) => {
        if (!this._data) return;
        const n = this._data.bars.length;
        let i = this._active;
        if (ev.key === "ArrowLeft") i = i < 0 ? n - 1 : Math.max(0, i - 1);
        else if (ev.key === "ArrowRight") i = i < 0 ? n - 1 : Math.min(n - 1, i + 1);
        else if (ev.key === "Home") i = 0;
        else if (ev.key === "End") i = n - 1;
        else if (ev.key === "Escape") i = -1;
        else return;
        ev.preventDefault();
        this._setActive(i);
      });
      plot.addEventListener("focus", () => {
        if (plot.matches(":focus-visible") && this._active < 0 && this._data) this._setActive(this._data.bars.length - 1);
      });
      plot.addEventListener("blur", () => this._setActive(-1));

      this._plotEl = plot;
      if (this._ro) {
        this._ro.disconnect();
        if (this._connected) this._ro.observe(plot);
      }
      this._built = true;
    }

    _render() {
      if (!this._config || !this._hass) return;
      if (!this._built) this._build();
      const root = this.shadowRoot;
      root.querySelectorAll(".toggle button").forEach((b) => b.classList.toggle("on", b.dataset.range === this._range.key));
      root.querySelectorAll(".chip").forEach((chip) => {
        const on = this._off.has(this._config.geraete[Number(chip.dataset.dev)].name);
        chip.classList.toggle("on", on);
        chip.setAttribute("aria-pressed", String(on));
      });

      const msg = root.querySelector(".msg");
      const chart = root.querySelector(".chart");
      const sub = root.querySelector(".sub");
      const data = this._data;
      if (!data) {
        msg.hidden = false;
        msg.classList.toggle("error", !!this._error);
        msg.textContent = this._error ? `Daten konnten nicht geladen werden: ${this._error}` : "Lade Verbrauchsdaten …";
        chart.hidden = true;
        sub.textContent = "";
        return;
      }
      msg.hidden = true;
      chart.hidden = false;
      // beim Umschalten bleibt das alte Diagramm blass stehen, bis die neuen Werte da sind
      const offNow = this._config.geraete.map((g) => g.name).filter((n) => this._off.has(n));
      chart.classList.toggle("loading", data.range.key !== this._range.key || data.off.join("|") !== offNow.join("|"));

      const bars = data.bars;
      const n = bars.length;
      const day = data.range.unit === "day";
      const withData = bars.filter((b) => b.value !== null);
      const done = withData.filter((b) => !b.current);
      const total = withData.reduce((a, b) => a + b.value, 0);
      const avg = done.length ? done.reduce((a, b) => a + b.value, 0) / done.length : null;
      let peak = 0;
      this._maxIdx = -1;
      bars.forEach((b, i) => {
        if (b.value !== null && b.value > 0 && b.value >= peak) {
          peak = b.value;
          this._maxIdx = i;
        }
      });
      this._scale = niceScale(peak);

      const parts = [this._rangeText()];
      if (data.off.length) parts.push(`ohne ${data.off.join(", ")}`);
      if (withData.length) {
        parts.push(`Σ ${this._kwh(total)} kWh`);
        if (avg !== null) parts.push(`Ø ${this._kwh(avg)} kWh/${day ? "Tag" : "Monat"}`);
      } else {
        parts.push("keine Daten");
      }
      sub.textContent = parts.map((p) => p.split(" ").join(NBSP)).join(NBSP + "· "); // umbrechen nur nach dem Punkt

      // Gitter und y-Achse
      const steps = Math.max(1, Math.round(this._scale.max / this._scale.step));
      const dec = decimalsOf(this._scale.step);
      const ticks = Array.from({ length: steps + 1 }, (_, k) => this._fmt(k * this._scale.step, dec));
      root.querySelector(".grid").innerHTML = ticks
        .map((_, k) => `<div class="gl${k === 0 ? " base" : ""}" style="bottom:${(k / steps) * 100}%"></div>`)
        .join("");
      root.querySelector(".yticks").innerHTML = ticks
        .map((t, k) => `<span style="bottom:${(k / steps) * 100}%">${t}</span>`)
        .join("");
      this._gutter = Math.ceil(Math.max(this._textW("kWh"), ...ticks.map((t) => this._textW(t))) + 10);
      chart.style.setProperty("--gutter", `${this._gutter}px`);

      // Säulen – neue Säulen wachsen beim ersten Zeichnen aus 0 heraus
      const barsEl = root.querySelector(".bars");
      const xEl = root.querySelector(".xaxis");
      chart.style.setProperty("--n", String(n));
      if (barsEl.children.length !== n) {
        const segs = PARTS.map(([k]) => `<i class="seg ${k}"></i>`).join("");
        barsEl.innerHTML = bars
          .map((_, i) => `<div class="slot" data-i="${i}"><div class="bar">${segs}</div><span class="lbl" hidden></span></div>`)
          .join("");
        xEl.innerHTML = bars.map(() => `<div class="xl"><span class="t"></span><span class="b"></span></div>`).join("");
        void barsEl.offsetWidth;
      }
      if (this._active >= n) this._active = -1;
      [...barsEl.children].forEach((slot, i) => {
        const b = bars[i];
        const pct = b.value === null ? 0 : Math.min(100, (b.value / this._scale.max) * 100);
        const barEl = slot.querySelector(".bar");
        barEl.style.height = `${pct}%`;
        barEl.classList.toggle("split", !!b.parts);
        barEl.querySelectorAll(".seg").forEach((seg, k) => {
          seg.style.flexGrow = b.parts ? String(b.parts[PARTS[k][0]]) : "0";
        });
        slot.classList.toggle("cur", b.current);
        slot.classList.toggle("none", b.value === null);
        slot.classList.toggle("on", i === this._active);
        let label = `${this._barTitle(b)}: ${b.value === null ? "keine Daten" : `${this._kwh(b.value)} kWh`}`;
        if (b.parts && b.value > 0) label += ` (${b.approx ? "ungefähr " : ""}${this._partsText(b.parts)})`;
        if (data.off.length && b.value !== null) label += `, ohne ${data.off.join(", ")}: ${this._kwh(b.ohne)} kWh`;
        slot.setAttribute("aria-label", label);
      });
      root.querySelector(".plot").setAttribute(
        "aria-label",
        `Hausverbrauch je ${day ? "Tag" : "Monat"}, ${sub.textContent}. Mit den Pfeiltasten durch die Säulen gehen.`,
      );

      // Legende mit den Anteilen im ganzen Zeitraum (nur bei Aufteilung – eine Farbe braucht keine Legende)
      const legend = root.querySelector(".legend");
      legend.textContent = "";
      const approx = withData.some((b) => b.approx);
      if (data.split) {
        const sums = PARTS.map(([k]) => withData.reduce((a, b) => a + (b.parts ? b.parts[k] : 0), 0));
        const pc = percents(sums);
        PARTS.forEach(([k, name], j) => {
          const item = document.createElement("span");
          item.className = "lg";
          const sw = document.createElement("i");
          sw.className = `sw ${k}`;
          item.append(sw, document.createTextNode(withData.length ? `${name} ${approx ? "≈" : ""}${pc[j]}${NBSP}%` : name));
          item.title = `${name}: ${approx ? "≈ " : ""}${this._kwh(sums[j])} kWh im Zeitraum${
            approx ? " (Aufteilung ohne Gerät aus dem Strommix des Tages geschätzt)" : ""
          }`;
          legend.appendChild(item);
        });
      }

      // Tabelle, neueste zuerst
      const cell = (tag, text, cls) => {
        const el = document.createElement(tag);
        el.textContent = text;
        if (cls) el.className = cls;
        return el;
      };
      const thead = root.querySelector(".values thead");
      const tbody = root.querySelector(".values tbody");
      thead.textContent = "";
      tbody.textContent = "";
      if (data.split) {
        const tr = document.createElement("tr");
        tr.appendChild(cell("th", ""));
        PARTS.forEach(([k, name]) => {
          const th = cell("th", name);
          const key = document.createElement("i");
          key.className = `key ${k}`;
          th.prepend(key);
          tr.appendChild(th);
        });
        tr.appendChild(cell("th", "Σ kWh"));
        if (data.off.length) tr.appendChild(cell("th", data.off.length === 1 ? data.off[0] : "Geräte"));
        thead.appendChild(tr);
      } else if (data.off.length) {
        const tr = document.createElement("tr");
        tr.append(cell("th", ""), cell("th", "kWh"), cell("th", data.off.length === 1 ? data.off[0] : "Geräte"));
        thead.appendChild(tr);
      }
      bars
        .slice()
        .reverse()
        .forEach((b) => {
          const tr = document.createElement("tr");
          if (b.current) tr.className = "cur";
          tr.appendChild(cell("td", b.current ? `${this._barName(b)} (bisher)` : this._barName(b)));
          const pre = b.approx ? "≈" : "";
          if (data.split) {
            PARTS.forEach(([k]) => tr.appendChild(cell("td", b.parts ? `${pre}${this._kwh(b.parts[k])}` : "–")));
            tr.appendChild(cell("td", b.value === null ? "–" : this._kwh(b.value), "sum"));
          } else {
            tr.appendChild(cell("td", b.value === null ? "–" : `${this._kwh(b.value)}${data.off.length ? "" : " kWh"}`));
          }
          if (data.off.length) tr.appendChild(cell("td", b.value === null ? "–" : this._kwh(b.ohne)));
          tbody.appendChild(tr);
        });

      const stamp = root.querySelector(".stamp");
      stamp.textContent = [`Stand ${this._time(data.cutoff)}`, this._error ? "Aktualisierung fehlgeschlagen" : ""]
        .filter(Boolean)
        .join(" · ");
      stamp.classList.toggle("error", !!this._error);

      this._layout();
      this._paintActive();
      requestAnimationFrame(() => this._layout());
    }

    // Beschriftungen nach der Breite: Tage dicht (Tag + Wochentag) oder licht (TT.MM. jede k-te Säule)
    _layout() {
      if (!this._data || !this._plotEl) return;
      const W = this._plotEl.clientWidth;
      const H = this._plotEl.clientHeight;
      if (!W || !H) return;
      const root = this.shadowRoot;
      const bars = this._data.bars;
      const n = bars.length;
      const slot = W / n;
      const day = this._data.range.unit === "day";

      // x-Achse
      const dense = day
        ? slot >= Math.max(this._textW("30"), this._textW("Mi")) + 6
        : slot >= Math.max(...MONTHS.map((m) => this._textW(m))) + 6;
      const wide = day ? this._textW("30.12.") : Math.max(...MONTHS.map((m) => this._textW(m)));
      const k = dense ? 1 : Math.max(1, Math.ceil((wide + 10) / slot));
      let lastYear = null;
      root.querySelectorAll(".xaxis .xl").forEach((cell, i) => {
        const b = bars[i];
        const show = (n - 1 - i) % k === 0;
        let t = "";
        let s = "";
        if (show && day) {
          t = dense ? String(b.date.getDate()) : `${pad2(b.date.getDate())}.${pad2(b.date.getMonth() + 1)}.`;
          s = dense ? WEEKDAYS[b.date.getDay()] : "";
        } else if (show) {
          // Jahr unter der ersten beschrifteten Säule und bei jedem Jahreswechsel
          t = MONTHS[b.date.getMonth()];
          s = b.date.getFullYear() !== lastYear ? String(b.date.getFullYear()) : "";
          lastYear = b.date.getFullYear();
        }
        cell.querySelector(".t").textContent = t;
        cell.querySelector(".b").textContent = s;
      });

      // Werte über der höchsten und der neuesten Säule – nur wenn sie nirgends anstoßen
      const innerH = H - PAD_TOP;
      const bw = Math.min(24, Math.max(0, slot - 2));
      const heights = bars.map((b) => (b.value === null ? 0 : Math.min(1, b.value / this._scale.max) * innerH));
      // Anteile, die keine 3 px hoch wären, bleiben weg (stehen aber im Tooltip und in der Tabelle)
      root.querySelectorAll(".bars .slot").forEach((el, i) => {
        const b = bars[i];
        el.querySelectorAll(".seg").forEach((seg, k) => {
          const v = b.parts ? b.parts[PARTS[k][0]] : 0;
          seg.classList.toggle("show", !!b.parts && b.value > 0 && (v / b.value) * heights[i] >= 3);
        });
      });
      root.querySelectorAll(".bars .slot").forEach((el, i) => {
        const lbl = el.querySelector(".lbl");
        const b = bars[i];
        const want = b.value !== null && n > 1 && (i === this._maxIdx || i === n - 1);
        if (!want) {
          lbl.hidden = true;
          return;
        }
        const text = this._kwh(b.value);
        const w = this._textW(text) + 4;
        let align = "c";
        let left = (i + 0.5) * slot - w / 2;
        if (left < 0) {
          align = "l";
          left = i * slot;
        } else if (left + w > W) {
          align = "r";
          left = (i + 1) * slot - w;
        }
        const bottom = heights[i] + 3;
        let clash = bottom + 14 > H;
        for (let j = 0; j < n && !clash; j += 1) {
          if (j === i) continue;
          const a = j * slot + (slot - bw) / 2;
          if (a + bw > left && a < left + w && heights[j] > bottom - 1) clash = true;
        }
        lbl.textContent = text;
        lbl.dataset.align = align;
        lbl.style.bottom = `${bottom}px`;
        lbl.hidden = clash;
      });

      this._placeTip();
    }

    _setActive(i) {
      if (!this._data) return;
      const next = i >= 0 && i < this._data.bars.length ? i : -1;
      if (next === this._active) return;
      this._active = next;
      this._paintActive();
    }

    _paintActive() {
      const root = this.shadowRoot;
      if (!this._data) return;
      root.querySelectorAll(".bars .slot").forEach((s, i) => s.classList.toggle("on", i === this._active));
      const tip = root.querySelector(".tip");
      if (this._active < 0) {
        tip.hidden = true;
        return;
      }
      const b = this._data.bars[this._active];
      const value = b.value === null ? "keine Daten" : `${this._kwh(b.value)} kWh`;
      tip.querySelector(".tv").textContent = value;
      tip.querySelector(".tl").textContent = b.current ? `${this._barTitle(b)} · läuft noch` : this._barTitle(b);
      const tp = tip.querySelector(".tp");
      tp.textContent = "";
      tp.hidden = !(b.parts && b.value > 0);
      if (!tp.hidden) {
        const pc = percents(PARTS.map(([k]) => b.parts[k]));
        PARTS.forEach(([k, name], j) => {
          const key = document.createElement("i");
          key.className = `key ${k}`;
          const pre = b.approx ? `≈${NBSP}` : "";
          const parts = [
            ["tn", name],
            ["tk", `${pre}${this._kwh(b.parts[k])} kWh`],
            ["tq", `${pc[j]}${NBSP}%`],
          ].map(([cls, text]) => {
            const el = document.createElement("span");
            el.className = cls;
            el.textContent = text;
            return el;
          });
          tp.append(key, ...parts);
        });
      }
      const tx = tip.querySelector(".tx");
      const off = this._data.off;
      tx.hidden = !off.length || b.value === null;
      tx.textContent = tx.hidden ? "" : `ohne ${off.join(", ")}: ${this._kwh(b.ohne)} kWh${b.approx ? `${NL}Aufteilung geschätzt` : ""}`;
      tip.hidden = false;
      root.querySelector(".live").textContent =
        `${this._barTitle(b)}: ${value}${tp.hidden ? "" : ` (${this._partsText(b.parts)})`}`;
      this._placeTip();
    }

    // Tooltip über der Säule; passt er dort nicht hin, neben die Säule
    _placeTip() {
      const tip = this.shadowRoot.querySelector(".tip");
      const plot = this._plotEl;
      if (!plot || tip.hidden || this._active < 0 || !this._data) return;
      const W = plot.clientWidth;
      const H = plot.clientHeight;
      const n = this._data.bars.length;
      const b = this._data.bars[this._active];
      const slot = W / n;
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      const frac = b.value === null ? 0 : Math.min(1, b.value / this._scale.max);
      const barTop = PAD_TOP + (H - PAD_TOP) * (1 - frac);
      const cx = (this._active + 0.5) * slot;
      const minLeft = -(this._gutter || 0);
      let left = Math.max(minLeft, Math.min(W - tw, cx - tw / 2));
      let top = barTop - th - 6;
      if (top < 0) {
        top = 2;
        const half = Math.min(24, slot - 2) / 2 + 6;
        left = cx + half + tw <= W ? cx + half : Math.max(minLeft, cx - half - tw);
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }
  }

  // ---------- Bearbeiten-Dialog ----------

  // ha-form lädt Home Assistant erst bei Bedarf – notfalls über den Editor einer eingebauten Karte nachladen
  const loadHaForm = async () => {
    if (customElements.get("ha-form")) return;
    try {
      const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      const card = helpers ? await helpers.createCardElement({ type: "button" }) : null;
      if (card && card.constructor.getConfigElement) await card.constructor.getConfigElement();
    } catch (e) {
      /* dann bleibt der Code-Editor */
    }
  };

  const rangeOptions = () => RANGE_CHOICES.map((k) => ({ value: k, label: parseRange(k).long }));
  const energyFilter = { domain: "sensor", device_class: "energy" };
  const EDITOR_SCHEMA = [
    { name: "title", selector: { text: {} } },
    { name: "range", required: true, selector: { select: { mode: "dropdown", custom_value: true, options: rangeOptions() } } },
    { name: "ranges", selector: { select: { multiple: true, custom_value: true, options: rangeOptions() } } },
    { name: "plus", selector: { entity: { multiple: true, filter: energyFilter } } },
    { name: "minus", selector: { entity: { multiple: true, filter: energyFilter } } },
    { name: "netz", selector: { entity: { multiple: true, filter: energyFilter } } },
    { name: "akku", selector: { entity: { multiple: true, filter: energyFilter } } },
    { name: "split", selector: { boolean: {} } },
    { name: "geraete", selector: { object: {} } },
    { name: "color", selector: { text: {} } },
  ];
  const EDITOR_LABELS = {
    title: "Überschrift",
    range: "Start-Zeitraum",
    ranges: "Zeiträume im Umschalter",
    plus: "Zähler, die addiert werden",
    minus: "Zähler, die abgezogen werden",
    netz: "Netzbezug (für die Aufteilung)",
    akku: "Akku-Entladung (für die Aufteilung)",
    split: "Nach Netz, PV und Akku aufteilen",
    geraete: "Geräte zum Ausklammern",
    color: "Säulenfarbe ohne Aufteilung",
  };
  const EDITOR_HELPERS = {
    range: "Bis 2 Monate Tagessäulen, ab 3 Monaten Monatssäulen. Eigene Werte z. B. 21d oder 24m.",
    ranges: "Eigenen Zeitraum eintippen und mit Enter hinzufügen; ein leerer Umschalter wird ausgeblendet.",
    plus: "Leer lassen = aus den Energie-Einstellungen (Netzbezug, Solar, Akku-Entladung).",
    minus: "Zum Beispiel Einspeisung und Akku-Ladung.",
    netz: "Ohne Netzbezug zeigt die Karte eine Farbe. Bei leerem „addiert“ kommt er aus den Energie-Einstellungen.",
    akku: "Zum Beispiel der Zähler der Akku-Entladung; leer = nur Netz und PV.",
    geraete: "Liste mit name und entity, z. B. „- name: Auto laden“ und darunter „entity: sensor.wallbox_energie“. Je Gerät gibt es einen Schalter „ohne …“.",
    color: "Zum Beispiel #6250d6 – leer lassen für die Standardfarbe.",
  };

  class HausverbrauchBalkenCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = { ...(config || {}) };
      this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._form) this._form.hass = hass;
    }

    _render() {
      if (!this._form) {
        this._form = document.createElement("ha-form");
        this._form.computeLabel = (s) => EDITOR_LABELS[s.name] || s.name;
        this._form.computeHelper = (s) => EDITOR_HELPERS[s.name] || "";
        this._form.addEventListener("value-changed", (ev) => this._changed(ev));
        this.appendChild(this._form);
      }
      const c = this._config;
      this._form.hass = this._hass;
      this._form.schema = EDITOR_SCHEMA;
      this._form.data = {
        title: c.title === undefined ? "Hausverbrauch" : c.title,
        range: c.range === undefined ? DEFAULT_RANGE : String(c.range),
        ranges: (Array.isArray(c.ranges) ? c.ranges : DEFAULT_RANGES).map(String),
        plus: Array.isArray(c.plus) ? c.plus : c.plus ? [c.plus] : [],
        minus: Array.isArray(c.minus) ? c.minus : c.minus ? [c.minus] : [],
        netz: Array.isArray(c.netz) ? c.netz : c.netz ? [c.netz] : [],
        akku: Array.isArray(c.akku) ? c.akku : c.akku ? [c.akku] : [],
        split: c.split !== false,
        geraete: Array.isArray(c.geraete) ? c.geraete : [],
        color: c.color || "",
      };
    }

    _changed(ev) {
      ev.stopPropagation();
      const v = (ev.detail && ev.detail.value) || {};
      const config = { ...this._config, ...v };
      config.ranges = cleanRanges(v.ranges).map((r) => r.key);
      if (!parseRange(config.range)) config.range = DEFAULT_RANGE;
      ["plus", "minus", "netz", "akku"].forEach((key) => {
        if (!Array.isArray(config[key]) || !config[key].length) delete config[key];
      });
      if (config.split !== false) delete config.split;
      if (!Array.isArray(config.geraete) || !config.geraete.length) delete config.geraete;
      if (!config.color) delete config.color;
      this._config = config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    }
  }

  customElements.define(EDITOR_TAG, HausverbrauchBalkenCardEditor);
  customElements.define(TAG, HausverbrauchBalkenCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: TAG,
    name: "Hausverbrauch als Säulen",
    description: "Gesamter Stromverbrauch je Tag oder Monat, aufgeteilt nach Netz, PV und Akku – umschaltbar von 14 Tagen bis 12 Monate, einzelne Geräte (z. B. Auto laden) abschaltbar.",
  });
  console.info(`%c HAUSVERBRAUCH-BALKEN-CARD %c ${VERSION} `, "color:#fff;background:#6250d6;font-weight:600", "color:#6250d6");
})();
