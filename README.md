# H8-H9-Simulator

Eine funktionsgetreue Nachbildung des Heathkit H8 (1977) im Browser: 8080A-Emulator, das
**originale PAM-8-Monitor-ROM**, ein H9-Video-Terminal (nach Original-Handbuch, werkseitige
12 Zeilen zu 80 Zeichen) und die H8-5 Serial/Kassetten-Interface-Karte. Eine abhängigkeitsfreie
Web-App ohne Build-Schritt – installierbar und nach dem ersten Aufruf auch offline nutzbar (PWA).

**▶ Direkt im Browser starten: <https://rolandkirsche.github.io/H8-H9-Simulator/>**

![H8 und H9 im Simulator: BASIC-Ausgabe auf dem H9-Terminal](docs/screenshot.png)

## Starten

Die App besteht aus ES-Modulen und muss deshalb über einen (beliebigen) Webserver laufen,
ein Doppelklick auf `index.html` (`file://`) genügt nicht:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Über das Installieren-Symbol in der Adressleiste
(Chrome/Edge) bzw. „Zum Home-Bildschirm“ (Safari) lässt sich der Simulator als App installieren.

## Aufbau

```
index.html              Seite (Markup)
css/app.css             Gestaltung
js/main.js              Einstieg: verdrahtet Module mit der Seite, registriert den Service Worker
js/panel.js             H8-Frontpanel: 7-Segment-Anzeige, Lampen, Tastenfeld, Tastatur-Kürzel
js/h8.js                H8-Maschine: PAM-8-ROM auf der CPU, Ports, USARTs der H8-5-Karte
js/cpu.js               8080A-Emulator
js/h9.js                H9-Video-Terminal
js/cassette.js          virtuelle Kassette
js/wire.js              serielle Leitung H8 ↔ H9
js/programs.js          per echten Tastendrücken eingetippte Programme, BASIC-Direktstart
js/audio.js             Piepser
js/data/                Original-ROM und Original-Kassettenabbild (Extended Benton Harbor BASIC)
sw.js, manifest.webmanifest, icons/   PWA (Offline-Cache, Installierbarkeit)
docs/manuals/           Original-Heathkit-Handbücher (PDF)
```

Details zur Architektur und den verwendeten Quellen stehen in [`CLAUDE.md`](CLAUDE.md).
