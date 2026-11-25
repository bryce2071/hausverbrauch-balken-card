# Hausverbrauch-Balken

Zeigt den gesamten Stromverbrauch des Hauses als Säulen – je Tag (z. B. 14 Tage, 1 Monat) oder je Monat
(3, 6, 12 Monate), umschaltbar oben rechts. Jede Säule ist nach Herkunft aufgeteilt: **Netz** (unten),
**PV** und **Akku**. Der laufende Tag bzw. Monat ist heller. Ein Tipp auf eine Säule zeigt Datum, Summe
und Aufteilung; unter „Werte“ stehen alle Zahlen als Tabelle.

Optional lassen sich einzelne Großverbraucher ausklammern (z. B. das Laden des E-Autos): Für jedes Gerät
gibt es oben einen Schalter „ohne …“.

*English: Total household electricity consumption as daily or monthly columns, split into grid, solar and
battery; optional switches to exclude big consumers such as EV charging. German user interface.*

## Installation

1. **Einstellungen → Marketplace → Über Link hinzufügen** und
   `https://github.com/bryce2071/hausverbrauch-balken-card` eintragen (Typ *Dashboard*), dann
   **Hausverbrauch-Balken** herunterladen. Die Ressource trägt der Marketplace selbst ein.
2. Browser bzw. App einmal neu laden. Danach steht die Karte in der Kartenauswahl.

Ohne weitere Angaben nimmt die Karte alles aus den **Energie-Einstellungen**: Verbrauch = Netzbezug −
Einspeisung + Solar + Akku-Entladung − Akku-Ladung.

## Beispiele

Nur aus den Energie-Einstellungen:

```yaml
type: custom:hausverbrauch-balken-card
title: Hausverbrauch
```

Mit eigenen Zählern und einem Schalter für das Auto:

```yaml
type: custom:hausverbrauch-balken-card
title: Hausverbrauch
range: 14d
ranges: [14d, 1m, 3m, 6m, 12m]
plus:
  - sensor.netzbezug
  - sensor.wechselrichter_energie
minus:
  - sensor.einspeisung
netz: [sensor.netzbezug]
akku: [sensor.akku_entladung]
geraete:
  - name: Auto laden
    entity: sensor.wallbox_energie
```

## Optionen

Alle außer `colors` auch im Bearbeiten-Dialog.

| Feld | Bedeutung |
|---|---|
| `title` | optional, Überschrift |
| `range` | optional, Start-Zeitraum: 1–90 Tage (`14d`) oder 1–36 Monate (`3m`); Standard `14d` |
| `ranges` | optional, Zeiträume im Umschalter (Standard `[14d, 1m, 3m, 6m, 12m]`); `[]` blendet ihn aus. Die Auswahl merkt sich der Browser. |
| `plus` | optional, Zähler (Langzeitstatistik), die addiert werden – leer = aus den Energie-Einstellungen |
| `minus` | optional, Zähler, die abgezogen werden (z. B. Einspeisung, Akku-Ladung) |
| `netz` | optional, Netzbezug für die Aufteilung; ohne `netz` eine Farbe |
| `akku` | optional, Akku-Entladung für die Aufteilung |
| `split` | optional, `false` = nicht aufteilen |
| `colors` | optional, `{ netz: "#488fc2", pv: "#ff9800", akku: "#4db6ac" }` |
| `color` | optional, Säulenfarbe ohne Aufteilung (Standard `#6250d6`) |
| `geraete` | optional, Geräte zum Ausklammern: je Gerät `name` und `entity` (ein Zähler oder eine Liste) |

Bis 2 Monate zeigt die Karte Tage (1 Monat = 30 Tage), ab 3 Monaten Monate.

## So wird gerechnet

- Verbrauch je Zeitraum = Summe der `plus`-Zähler − Summe der `minus`-Zähler aus der Langzeitstatistik.
- Aufteilung je Abschnitt: Netz = Netzbezug (höchstens der Verbrauch), Akku = Akku-Entladung (höchstens der
  Rest), PV = was übrig bleibt.
- Zählersprünge (negativ oder mehr als 500 kWh am Tag bzw. 50 kWh je Stunde) gelten als Zählerfehler und
  zählen nicht.
- Der heutige Tag kommt aus den Stundenwerten plus den 5-Minuten-Werten der laufenden Stunde.
- Ein ausgeklammertes Gerät bekommt den Strommix des Hauses in derselben Stunde (Tagesansicht) bzw. am
  selben Tag (Monatsansicht, dort deshalb „≈“). Die Schalter merkt sich der Browser.

## Hinweise

- Wer die Datei vorher von Hand eingebunden hatte (`/local/hausverbrauch-balken-card.js`), entfernt diese
  Ressource (**Einstellungen → Dashboards → ⋮ → Ressourcen**), sonst lädt der Browser die ältere Fassung.

## Lizenz

MIT
