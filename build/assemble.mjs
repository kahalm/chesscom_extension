// Build-Schritt: single-sourcet die geteilten Module in das Userscript.
//
// Quelle der Wahrheit sind die Dateien unter extension/lib/. Die Extension lädt sie als
// Content-Scripts (self.RepCheckLib); der Userscript kann keine separate Datei laden, daher
// wird der Inhalt hier in repcheck.user.js zwischen den Sentinel-Markern eingefügt. So gibt
// es nur EINE Quelle.
//
// Aufruf:  npm run build:userscript   (bzw. node build/assemble.mjs)
// Idempotent: mehrfaches Ausführen erzeugt dasselbe Ergebnis.
//
// Eine weitere geteilte Datei aufnehmen = einen Eintrag in REGIONEN ergänzen und das
// Marker-Paar an der passenden Stelle in repcheck.user.js einfügen. Der `from`/`to`-Ausschnitt
// hält den Export-Block (`module.exports`/`self.RepCheckLib`) draußen — im Userscript gibt es
// weder CommonJS noch ein Lib-Objekt, dort stehen die Funktionen einfach im IIFE-Scope.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER = join(root, 'repcheck.user.js');

const REGIONEN = [
  {
    name: 'repertoire-text',
    lib: 'extension/lib/repertoire-text.js',
    from: 'function tokenizePgn',
    to: '// Node/CommonJS-Export',
    indent: '  ',
  },
  {
    name: 'i18n',
    lib: 'extension/lib/i18n.js',
    from: 'const RC_MESSAGES',
    to: '// Node/CommonJS-Export',
    indent: '  ',
  },
  {
    name: 'chessable-feedback',
    lib: 'extension/lib/chessable-feedback.js',
    from: 'const RC_FEEDBACK_KINDS',
    to: '// Node/CommonJS-Export',
    indent: '  ',
  },
  {
    name: 'chessable-course-names',
    lib: 'extension/lib/chessable-course-names.js',
    from: 'function rcB64UrlDecode',
    to: '// Node/CommonJS-Export',
    indent: '  ',
  },
];

let user = readFileSync(USER, 'utf8');
const geaendert = [];

for (const region of REGIONEN) {
  const BEGIN = `${region.indent}// >>>REPCHECK-SHARED:${region.name}`;
  const END = `${region.indent}// <<<REPCHECK-SHARED:${region.name}`;

  const lib = readFileSync(join(root, region.lib), 'utf8');
  const start = lib.indexOf(region.from);
  const end = lib.indexOf(region.to);
  if (start < 0 || end < 0 || end < start) {
    console.error(`assemble: Funktionsbereich in ${region.lib} nicht gefunden — `
      + `Anker "${region.from}" / "${region.to}" verändert?`);
    process.exit(1);
  }
  const core = lib.slice(start, end).trimEnd();
  // Auf die Userscript-IIFE-Einrückung bringen.
  const indented = core.split('\n').map((l) => (l.length ? region.indent + l : l)).join('\n');

  const bi = user.indexOf(BEGIN);
  const ei = user.indexOf(END);
  if (bi < 0 || ei < 0 || ei < bi) {
    console.error(`assemble: Sentinel-Marker "${region.name}" in repcheck.user.js nicht gefunden.`);
    process.exit(1);
  }
  const neu = user.slice(0, bi + BEGIN.length) + '\n' + indented + '\n' + user.slice(ei);
  if (neu !== user) {
    user = neu;
    geaendert.push(region.name);
  }
}

if (geaendert.length) {
  writeFileSync(USER, user);
  console.log(`assemble: repcheck.user.js neu erzeugt — Regionen: ${geaendert.join(', ')}.`);
} else {
  console.log('assemble: bereits aktuell (keine Änderung).');
}
