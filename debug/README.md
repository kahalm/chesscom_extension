# Debug-Werkzeuge (nicht für die Stores)

## chessable-inspector.user.js
Diagnose-Userscript für die Fehleranalyse auf chessable.com (z. B. Zen-Vollbild-
Drag&Drop). In Tampermonkey installieren, Trainingsseite öffnen, unten LINKS:

- **RC-Debug: Snapshot** — Brett-Ankerkette (Geometrie, Computed-Styles inkl.
  zoom/transform, offsetWidth vs. Rect), Feld-/Figuren-Beispiele, getrimmtes
  Brett-outerHTML, Viewport/Fullscreen-Zustand.
- **Record 6s** — 6 Sekunden Pointer-Events + Style-/Klassen-Mutationen im
  Brettbereich + Rechtecke der bewegten Figur. Während der Aufnahme eine Figur
  ziehen; für Vollbild-Analysen vorher den Zen-Modus aktivieren.

Ergebnis landet in der Zwischenablage UND als .json-Download. Für die Analyse
je einen Snapshot normal + im Vollbild sowie eine Recording-Datei vom
Drag-Versuch im Vollbild liefern.
