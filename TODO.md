# TODO — Browser-Extension Release-Vorbereitung

Was noch manuell erledigt werden muss, bevor die Extension öffentlich veröffentlicht werden kann. Code-Seite ist fertig (siehe `extension/`, Workflows in `.github/workflows/`, MIT-Lizenz, Privacy Policy, GitHub-Pages-Setup).

## Sofort machbar (kein Geld nötig)

- [ ] **GitHub Pages aktivieren**
  Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: **master** → Folder: **/docs** → Save.
  Nach 1–2 Minuten live unter `https://kahalm.github.io/repcheck/`. Diese URL muss in der Chrome-/AMO-Submission als Privacy-Policy-Link angegeben werden (`/privacy.html`).

- [ ] **Erstes Release-Tag setzen** (testet den Workflow)
  ```bash
  git tag v1.3.1 -m "Browser-Extension polish: icons, CI/CD, docs"
  git push origin v1.3.1
  ```
  Erzeugt automatisch ein GitHub Release mit ZIP-Anhang. Prüfen unter „Releases" im Repo.

- [ ] **Lokal in beiden Browsern testen** (Smoke-Test vor Submission)
  - **Chrome**: `chrome://extensions/` → Entwicklermodus → „Entpackt laden" → `extension/`-Ordner. Auf chess.com Analyse-Seite öffnen, ⚙ klicken, RookHub-URL + Token eintragen, „Verbinden" → Status sollte „Eröffnungen geladen" zeigen, Abweichungen markiert.
  - **Firefox**: `about:debugging` → „Temporäres Add-on laden" → `extension/manifest.json`. Gleiche Smoke-Tests.
  - Optional komfortabler: `npm i -g web-ext` + `cd extension && web-ext run` (Auto-Reload) bzw. `web-ext run --target=chromium`.

- [ ] **Screenshots für Stores erstellen** (1280×800 oder 640×400)
  Mindestens einen Screenshot je Store. Empfohlen: 3–5 Stück
  1. chess.com-Analyse mit roter Markierung an der Deviation
  2. Settings-Panel (⚙) mit RookHub-Verbindung
  3. RookHub-Profil mit „Extension-Tokens"-Sektion
  4. Popup mit Cache-Status
  
  Dateien können in `docs/screenshots/` abgelegt und über GitHub Pages verlinkt werden.

## Mit AMO-Account (kostenlos)

- [ ] **Firefox-AMO-Developer-Account anlegen**
  Bei [addons.mozilla.org/developers/](https://addons.mozilla.org/developers/) einloggen.

- [ ] **AMO-API-Key generieren**
  [addons.mozilla.org/developers/addon/api/key/](https://addons.mozilla.org/developers/addon/api/key/) → „Generate new credentials" → API-Key + API-Secret notieren.

- [ ] **AMO-Secrets im Repo hinterlegen**
  Repo → Settings → Secrets and variables → Actions → New repository secret:
  - `AMO_API_KEY` = JWT-Issuer aus AMO
  - `AMO_API_SECRET` = JWT-Secret aus AMO
  
  Beim nächsten Release-Tag (`git tag v… && git push origin v…`) wird die Extension automatisch für Firefox signiert (`.xpi` im Release-Anhang).

- [ ] **AMO-Listing erstellen**
  AMO-Devhub → „Submit New Add-on" → ZIP/XPI hochladen → Beschreibung, Screenshots, Kategorien, Sprachen → Submit. Review meist <24h.
  
  Listing-Felder vorbereiten:
  - **Name**: RepCheck — Opening Repertoire Deviation Checker
  - **Summary**: max 250 Zeichen, z.B. „Markiert auf chess.com Analyse-Seiten, ab welchem Zug deine Partie aus dem Eröffnungsrepertoire heraus läuft. Lokal oder mit RookHub-Server."
  - **Description**: längere Variante mit Setup-Anleitung (kopierbar aus README)
  - **Privacy Policy URL**: `https://kahalm.github.io/repcheck/privacy.html`
  - **Homepage URL**: `https://github.com/kahalm/repcheck`
  - **Support URL**: `https://github.com/kahalm/repcheck/issues`
  - **License**: MIT (gleich auswählen)

## Mit Chrome-Developer-Account (5 USD einmalig)

- [ ] **Chrome Web Store Developer-Account anlegen**
  [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) → Google-Login → 5 USD Lifetime-Fee bezahlen.

- [ ] **Chrome-Submission vorbereiten**
  - ZIP aus dem letzten Release herunterladen (oder lokal mit `cd extension && web-ext build`)
  - „New Item" → ZIP hochladen
  - Beschreibung, Kategorie „Productivity" oder „Fun", Screenshots
  - Privacy-Policy-URL: `https://kahalm.github.io/repcheck/privacy.html`
  - Permissions begründen: `host_permissions: https://*/*` → „User trägt seine eigene RookHub-Instanz ein, Extension muss dorthin Auth-Requests senden."
  - Submit → Review 1–3 Tage.

## Chessable-Trainingsmodus (User-Wunsch 2026-08-08)

- [ ] **Pfeile/Markierungen fehlen im Vollbild (Zen-Modus)**
  Auf chessable.com zeigt das Brett im Zen-Vollbild die Pfeile/Feld-Markierungen nicht mehr an,
  die im Normalmodus da sind. Vermutung (zu prüfen): Chessable rendert sie in einem eigenen
  Layer/SVG, der außerhalb des Brett-Elements hängt und deshalb hinter dem Backdrop landet bzw.
  nicht mit skaliert wird — analog zur Schwebefigur beim Drag&Drop, für die `body > .piece-417db`
  schon eine z-Index-Regel im Zen-Style bekommt (`chessable-fen.js`, `ZEN_STYLE_ID`).
  Erst mit dem Debug-Inspector (`debug/chessable-inspector.user.js`) einen Snapshot im Normal- und
  im Zen-Modus vergleichen, dann den Layer gezielt hochziehen.

- [ ] **Zug-Feedback anzeigen: Overstudy vs. +XP**
  Nach einem Zug zeigt Chessable an, ob der Zug „overstudied" war oder wieviel XP er gebracht hat.
  Das soll RepCheck ebenfalls sichtbar machen (der Nutzer sieht es im Zen-Modus sonst nicht).
  Quelle ist vermutlich `[data-testid="moveNotification"]` — genau der Knoten, den der frühere
  XP-Tracker (`initPointsTracker`, seit v1.14.3 deaktiviert, Code noch vorhanden) beobachtet hat.
  Dort wurden „Overstudied"/„Incorrect"/„Alternative" bewusst ignoriert; jetzt sollen sie
  unterschieden und angezeigt werden. Passende Stelle für die Anzeige suchen (Zen-Leiste?).

- [ ] **Vollbild nach dem Refresh-Knopf erhalten — GEPRÜFT: nur teilweise möglich**
  Der Refresh-Knopf macht `location.reload()` (`chessable-fen.js:678`). Echtes Vollbild kann das
  NICHT überleben: der Zen-Modus nutzt `document.documentElement.requestFullscreen()`
  (`chessable-fen.js:480`), also **Element-Vollbild** — das ist Dokument-Zustand und geht bei jeder
  Navigation verloren. Es danach automatisch wiederherzustellen ist ausgeschlossen, weil
  `requestFullscreen()` eine frische Nutzer-Interaktion verlangt; ein Aufruf beim Laden wird vom
  Browser abgelehnt. (Anders als F11-Browservollbild, das ein Reload überlebt — das können wir aber
  nicht setzen.)
  **Machbar ist die halbe Miete:** der Zen-Modus besteht aus ZWEI Teilen — (a) unserem eigenen
  Backdrop + vergrößertem Brett (reines DOM/CSS, `ZEN_BACKDROP_ID`) und (b) dem Browser-Vollbild.
  Teil (a) lässt sich nach dem Reload sofort und ohne Nutzergeste wiederherstellen (Flag in
  `sessionStorage` vor dem Reload setzen, beim Init auslesen und `enterZen` ohne den
  `requestFullscreen`-Aufruf anwenden). Der Nutzer landet dann wieder auf großem Brett mit dunklem
  Hintergrund und braucht nur EINEN Klick auf ⛶, um auch das Browser-Vollbild zurückzuholen.
  Offen zu entscheiden: ob dieser Zwischenzustand gewünscht ist oder verwirrt (Knopf zeigt dann
  „⛶", obwohl es schon fast wie Vollbild aussieht).

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

- [ ] **Gesamt-XP am Linienende aufklappbar machen** (User-Wunsch 2026-08-08)
  Am Ende einer Linie zeigt Chessable die Gesamt-XP (in beiden Modi). Diese Summe soll klickbar
  sein und die **Einzelbeträge** zeigen, aus denen sie sich zusammensetzt. Hängt direkt am
  Zug-Feedback oben: wenn RepCheck die Pro-Zug-Meldungen ohnehin mitschneidet, ist die
  Aufschlüsselung nur noch eine Anzeige der gesammelten Liste (kein zusätzlicher Datenzugriff).
  Offen: ob die Summe von Chessable exakt der Summe der Einzelmeldungen entspricht (Rundung,
  Boni am Linienende) — sonst muss die Aufschlüsselung als „erfasste Einzelbeträge" beschriftet
  werden statt als Zerlegung der Summe. Erfasst wird das mit Inspector v0.2.0 (`xpAnzeigen`).

- [ ] **Restliche Linien im Trainingspool anzeigen**
  Irgendwo sichtbar machen, wieviele Linien im aktuellen Trainingspool noch offen sind.
  Datenquelle klären: Chessables eigene Fortschrittsanzeige (DOM) oder der bereits vorhandene
  Fortschritts-Abruf (`ensureProgress` → `getCourse?includeVariations=true` in
  `chessable-activity.js`, liefert die Linien-Liste inkl. Status). Achtung: dieser Abruf läuft
  seit v1.38.1 nur noch mit konfigurierter RookHub-Instanz — für eine reine Anzeige ohne RookHub
  bräuchte es eine andere Quelle oder eine bewusste Ausnahme.

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
