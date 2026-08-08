# TODO — Browser-Extension Release-Vorbereitung

Was noch manuell erledigt werden muss, bevor die Extension öffentlich veröffentlicht werden kann. Code-Seite ist fertig (siehe `extension/`, Workflows in `.github/workflows/`, MIT-Lizenz, Privacy Policy, GitHub-Pages-Setup).

## Release-Vorbereitung — ERLEDIGT (Stand 2026-08-08)

Die Extension ist in **beiden Stores live** und wird per Tag automatisch eingereicht; die
ursprüngliche Checkliste ist damit abgearbeitet. Belegt am 08.08.:

- [x] **GitHub Pages** — `https://kahalm.github.io/repcheck/privacy.html` liefert HTTP 200
  (Privacy-Policy-Link für beide Stores).
- [x] **Release-Workflow** — Tag `v*.*.*` erzeugt GitHub-Release + ZIP und reicht bei AMO **und**
  Chrome Web Store ein (Secrets hinterlegt). Letzter Lauf v1.40.0: AMO hochgeladen,
  CWS `uploadState: SUCCESS` + Publish `OK`.
- [x] **AMO** — Account, API-Key, Secrets, Listing stehen; Add-on ist öffentlich (`status: public`),
  aktuelle Version dort **1.40.0**.
- [x] **Chrome Web Store** — Account + Listing stehen, Item-ID `mhddbldcaancdahlochjanpkkboaccpn`,
  Einreichung läuft über die CI.
- [x] **Store-Screenshots** — vorhanden (ohne sie wäre keine der beiden Freigaben erfolgt).

Wiederkehrend (kein einmaliges TODO):
- [ ] **Vor jedem Store-Release kurz in beiden Browsern smoke-testen** — Chrome
  (`chrome://extensions` → „Entpackt laden" → `extension/`) und Firefox (`about:debugging` →
  „Temporäres Add-on" → `extension/manifest.json`): auf chess.com eine Analyse-Seite öffnen
  (Abweichungen markiert?) und auf chessable.com Practice (Knopfleiste, Zen-Vollbild,
  Zug-Rückmeldung).

## Chessable-Trainingsmodus (User-Wunsch 2026-08-08)

- [ ] **Pfeile/Markierungen fehlen im Vollbild (Zen-Modus)** — MESSUNG 08.08. ausgewertet, noch offen
  Ergebnis der Dumps (`snapshotPfeile*.json`): das einzige `<svg>` IM Brett ist Chessables
  Hintergrund (`board-blue-fallback chessboard-bg`, `z-index:-1`) — es skaliert im Zen korrekt mit
  (499×500 → 834×834). Ein Pfeil-/Annotations-Layer war in BEIDEN Snapshots **gar nicht im DOM**,
  also war zum Messzeitpunkt kein Pfeil aktiv. Dafür ist der Mechanismus jetzt bekannt und belegt:
  Chessables Zug-Rückmeldung sitzt in `.board-footer` (in `#row-practice__col2`), also AUSSERHALB
  des Bretts — und liegt damit hinter unserem Zen-Backdrop (z-index 2147483600). Pfeile dürften
  denselben Weg gehen. Nächster Schritt: EIN Snapshot, während ein Pfeil sichtbar ist (Inspector
  v0.2.0 erfasst `overlays` dokumentweit) — dann ist entschieden, ob ein gezieltes Hochziehen des
  Layers reicht.
  Auf chessable.com zeigt das Brett im Zen-Vollbild die Pfeile/Feld-Markierungen nicht mehr an,
  die im Normalmodus da sind. Vermutung (zu prüfen): Chessable rendert sie in einem eigenen
  Layer/SVG, der außerhalb des Brett-Elements hängt und deshalb hinter dem Backdrop landet bzw.
  nicht mit skaliert wird — analog zur Schwebefigur beim Drag&Drop, für die `body > .piece-417db`
  schon eine z-Index-Regel im Zen-Style bekommt (`chessable-fen.js`, `ZEN_STYLE_ID`).
  Erst mit dem Debug-Inspector (`debug/chessable-inspector.user.js`) einen Snapshot im Normal- und
  im Zen-Modus vergleichen, dann den Layer gezielt hochziehen.

- [x] **Zug-Feedback anzeigen: Overstudy vs. +XP** — ERLEDIGT v1.40.0, zwei Zählfehler behoben in
  v1.41.1: (a) wortgleiche Meldungen hintereinander (drei „Overstudied") fielen auf EINEN Eintrag
  zusammen — verglichen wurde nur der Text, und der Leerlauf zwischen zwei Zügen löschte die
  Vergleichsmarke nicht; (b) beim Linienwechsel wurde nicht zurückgesetzt (Liste + Summe liefen über
  die Sitzung weiter), weil der Reset allein an einem Klick auf einen Knopf mit passender
  Beschriftung hing. Beides hängt jetzt an der Halbzug-Nummer der Stellung statt am Wortlaut/Klick.
  **Noch nicht im Browser gegengeprüft** — siehe Smoke-Test-Punkt oben.
  Nach einem Zug zeigt Chessable an, ob der Zug „overstudied" war oder wieviel XP er gebracht hat.
  Das soll RepCheck ebenfalls sichtbar machen (der Nutzer sieht es im Zen-Modus sonst nicht).
  Quelle ist vermutlich `[data-testid="moveNotification"]` — genau der Knoten, den der frühere
  XP-Tracker (`initPointsTracker`, seit v1.14.3 deaktiviert, Code noch vorhanden) beobachtet hat.
  Dort wurden „Overstudied"/„Incorrect"/„Alternative" bewusst ignoriert; jetzt sollen sie
  unterschieden und angezeigt werden. Passende Stelle für die Anzeige suchen (Zen-Leiste?).

- [x] **Vollbild nach dem Refresh-Knopf erhalten** — GEBAUT (v1.39.0) und auf Nutzerwunsch WIEDER
  ENTFERNT (v1.41.0). Echtes Vollbild kann einen Reload nicht überleben (`requestFullscreen()`
  verlangt eine frische Nutzergeste); wiederhergestellt wurde deshalb nur der Zen-Aufbau ohne
  Browser-Vollbild, mit einem dritten Knopf-Zustand „Vollbild fortsetzen". Genau dieser
  Zwischenzustand hat in der Praxis gestört — der Vorbehalt aus der Planung hat sich bestätigt.
  Falls das Thema wiederkommt: nicht denselben Weg nochmal gehen, sondern beim Refresh gar nicht
  erst aus dem Zen fallen (z. B. Inhalt neu laden statt `location.reload()`).


- [ ] **Nach dem Refresh automatisch an die richtige Stelle zurückspielen** (User-Wunsch 2026-08-08)
  Zweck des Refresh-Knopfes ist, einen Verklicker nicht als Fehler werten zu lassen — er wirft den
  Nutzer aber an den Linienanfang zurück. Wunsch: die bereits gespielten Züge automatisch
  nachspielen.
  **Machbarkeit — die Bausteine sind belegt** (aus `dumps/repcheck-inspector-recording-*.json`):
  - Feld-Elemente sind eindeutig adressierbar: die IDs beginnen mit dem Feldnamen
    (`DIV#e4-2760-7211-…`, `DIV#d2-3e6e-…`), zusätzlich tragen sie eine `square-<feld>`-Klasse.
  - **Klick-Klick-Eingabe funktioniert**: nach dem ersten Klick erscheinen die
    Legalzug-Markierungen (61 `highlight-legal-mt2`-Mutationen im Mitschnitt), der zweite Klick
    aufs Zielfeld führt den Zug aus. Ein Zug lässt sich also ohne Drag-Simulation auslösen.
  - Dass synthetische Klicks bei Chessable ankommen, ist durch den ▸-Knopf bereits belegt (der
    ruft `el.click()` auf Chessables eigenem „Next"-Button).
  **Was noch offen ist (und vor dem Bauen geklärt werden MUSS):**
  1. Serviert Chessable nach dem Reload überhaupt DIESELBE Linie? Der Move-Trainer zieht die
     nächste fällige — kommt eine andere, dürfte NICHTS nachgespielt werden. Erkennung über die
     Linien-/oid-Kennung bzw. die Start-FEN (Inspector v0.2.0 erfasst `progress.props`).
  2. Nehmen die Brett-Handler synthetische Pointer-Events an (isTrusted=false)? Der ▸-Knopf beweist
     es für React-Buttons, nicht für den Brett-Layer.
  3. Timing: nach jedem eigenen Zug antwortet der Gegner animiert — der nächste Klick darf erst
     nach dem Settle kommen (Brett-Mutation abwarten, nicht blind `setTimeout`).
  **Sicherheitsregel für die Umsetzung:** vor JEDEM nachgespielten Zug die aktuelle Stellung gegen
  die erwartete prüfen und bei Abweichung sofort abbrechen (mit sichtbarem Hinweis). Ein
  „danebengegangener" Nachspiel-Zug wäre genau der Fehler, den der Nutzer vermeiden will — lieber
  gar nicht nachspielen als falsch.
  **Zu erwägen:** die Züge liegen ohnehin schon vor (RepCheck sieht jeden Zug für die
  Trainingszeit-Messung); der `ZEN_RESTORE_KEY`-Mechanismus aus v1.39.0 ist die passende Stelle,
  um sie über den Reload zu retten.

- [x] **Gesamt-XP am Linienende aufklappbar machen** — TEILWEISE ERLEDIGT v1.40.0 (RepCheck schlüsselt die SELBST erfassten Einzelbeträge auf; Chessables eigene Endsumme wird nicht ausgelesen, Boni am Linienende fehlen deshalb — im Panel ausgewiesen)
  Am Ende einer Linie zeigt Chessable die Gesamt-XP (in beiden Modi). Diese Summe soll klickbar
  sein und die **Einzelbeträge** zeigen, aus denen sie sich zusammensetzt. Hängt direkt am
  Zug-Feedback oben: wenn RepCheck die Pro-Zug-Meldungen ohnehin mitschneidet, ist die
  Aufschlüsselung nur noch eine Anzeige der gesammelten Liste (kein zusätzlicher Datenzugriff).
  Offen: ob die Summe von Chessable exakt der Summe der Einzelmeldungen entspricht (Rundung,
  Boni am Linienende) — sonst muss die Aufschlüsselung als „erfasste Einzelbeträge" beschriftet
  werden statt als Zerlegung der Summe. Erfasst wird das mit Inspector v0.2.0 (`xpAnzeigen`).

- [ ] **Restliche Linien im Trainingspool anzeigen** — MESSUNG AUSGEWERTET, Inspector v0.3.1 gebaut
  **Korrektur der alten Notiz:** hier stand, die Messung habe „nur die Brett-Koordinaten 8/7/6/5"
  gefunden. Das war zu knapp und hat die nächste Runde in die falsche Richtung geschickt. In
  `snapshotPfeile.json` steht sehr wohl eine Kennzahlenzeile — drei gleichartige Zellen
  (`100%`, `1`, `180`, Klasse `sc-ckCjom ggKGUz`, gleiche Höhe, je 85,5 px breit) plus ein
  klassenloser `99`er-SPAN.

  **Was davon ausscheidet (belegt, nicht vermutet):**
  - `180` ist Sitzungs-XP, kein Pool-Rest: `xpAnzeigen` geht von „78.503.115 points to" auf
    „78.502.935 points to" — Differenz exakt 180, passend zu den erfassten „+20/+30/+60 XP".
  - `99` ist über alle vier Dumps vom 08.08. (08:56 bis 09:01) KONSTANT, während sich die XP
    änderten. Ein Rest-Zähler eines laufenden Pools würde in fünf Minuten Training sinken.
  - Es gibt dokumentweit KEIN `[role="progressbar"]`, kein `x/y`-Muster und keinen Treffer auf
    `remaining|left|due|queue|pool|verbleibend|offen` in irgendeinem der sieben Dumps.

  **Der eigentliche Fundort — und warum ihn keine Messung erreichte:** der Move-Trainer-Drawer
  `#mt-drawer` (in `.MuiDrawer-root.ui23-sidebar-drawer`, links, 360 px breit) ist ein
  SCHWESTER-Zweig neben `.row-practice`. Wer vom Brett aus sucht — per `closest()` im DOM oder
  per `fiber.return` im React-Baum — kommt dort prinzipiell nie an. Genau das taten alle
  bisherigen Sammler. Im Drawer stecken `mt-drawer-content__chapter` und
  `mt-drawer-content__variations__link` mit `oid`/`lid` sowie `#currentStudyingVariation`, also
  die Linien-Identität. Im gemessenen Zustand war allerdings nur EINE Variante gerendert
  (Höhen 60 + 52 = 112), der Drawer zeigte also die laufende Linie, nicht den Pool.

  **Nächster Schritt (Inspector v0.3.1 kann das jetzt):** einen Dump mit AUFGEKLAPPTEM Drawer
  ziehen, am besten über den neuen Knopf „Record 30s (Pool)" — der schneidet zusätzlich die
  Chessable-API-Antworten mit und protokolliert den Zähler-Verlauf im Halbsekundentakt. Wenn
  eine Linie fertig wird, zeigt die Differenz, welcher Wert sich mitbewegt. Neu erfasst werden
  ausserdem `drawer` (vollständig, strukturiert nach Kapiteln/Linien), `zaehler` (dokumentweit
  MIT Beschriftung statt nackter Zahlen), `fiberScan` an drei Ankern inkl. Hook-State,
  Seiten-State und Speicher.

  Falls die Zahl im DOM gar nicht steht: Rückfallweg bleibt Chessables eigener Fortschritts-Abruf
  (`ensureProgress` → `getCourse?includeVariations=true` in `chessable-activity.js`) — der läuft
  seit v1.38.1 aber nur mit konfigurierter RookHub-Instanz, für eine reine Anzeige bräuchte es
  eine bewusste Ausnahme.

## Optional / Später

- [ ] **Edge Add-ons Submission**
  Chrome-Store-Extensions sind in Edge automatisch installierbar. Eine eigene [Edge-Submission](https://partner.microsoft.com/dashboard/microsoftedge/) ist trotzdem möglich (kostenlos), erhöht aber Pflegeaufwand.

- [ ] **Userscript-Distribution** (alternative für User ohne Store-Extension)
  Tampermonkey-User können direkt von GitHub-Raw installieren:
  `https://raw.githubusercontent.com/kahalm/repcheck/master/repcheck.user.js`
  
  Auto-Update läuft bereits über die `@updateURL`/`@downloadURL` im Header.
  Eventuell: in Greasy Fork oder OpenUserJS listen für Discoverability.

- [ ] **Echte Icons** (statt der jetzt-rein-geometrischen Turm-Silhouette)
  Wenn jemand mit Grafik-Sense Lust hat: ein 128×128-PNG mit ordentlicher Schach-Turm-Illustration ersetzen. `extension/generate-icons.py` kann auch entfernt werden, wenn die PNGs handgemacht sind.

- [ ] **Code-Sync-Script** zwischen `repcheck.user.js` (Userscript) und `extension/content.js` (Extension)
  Aktuell pflegen wir beide getrennt. Klein und überschaubar, aber bei der nächsten größeren Feature-Änderung leicht zu vergessen. Ein Build-Script, das nur die `rookhub*Fetch*`-Funktionen austauscht, würde Konsistenz garantieren.

- [ ] **i18n** für die Extension-Settings-UI
  Aktuell alles auf Deutsch (matches RookHub-Stand). Englisch + Croatian parallel würden mit der RookHub-i18n-Linie konsistent sein.

## Erledigt ✓

- [x] Manifest V3 für Chrome + Firefox 109+
- [x] Background-Service-Worker für CORS-freie RookHub-Fetches
- [x] Popup-HTML mit Cache-Status
- [x] Icons 16/48/128 (Turm-Silhouette, regenerierbar)
- [x] `web-ext lint` 0 Errors
- [x] `web-ext build` produziert 40 KB ZIP
- [x] `PRIVACY.md` (Repo) und `docs/privacy.md` (Pages)
- [x] MIT-Lizenz
- [x] GitHub-Actions Build-Workflow
- [x] GitHub-Actions Release-Workflow (mit optional AMO-Sign)
- [x] Userscript-Auto-Update via `@updateURL`/`@downloadURL`
- [x] README + CLAUDE.md aktualisiert
