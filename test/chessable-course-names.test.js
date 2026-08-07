'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { decodeChessableUid, parseCourseNameMap, isNavLabel } =
  require('../extension/lib/chessable-course-names.js');

// Baut einen JWT (nur Payload zählt) mit base64url-kodiertem JSON.
function jwt(payloadObj) {
  const b64url = (s) => Buffer.from(s).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'h.' + b64url(JSON.stringify(payloadObj)) + '.sig';
}

test('decodeChessableUid liest user.uid aus dem JWT-Payload', () => {
  assert.strictEqual(decodeChessableUid(jwt({ user: { uid: 790927 }, exp: 1 })), '790927');
});

test('decodeChessableUid akzeptiert String-uid', () => {
  assert.strictEqual(decodeChessableUid(jwt({ user: { uid: '42' } })), '42');
});

test('decodeChessableUid gibt null bei fehlender/kaputter uid', () => {
  assert.strictEqual(decodeChessableUid(jwt({ user: {} })), null);
  assert.strictEqual(decodeChessableUid(jwt({ nope: 1 })), null);
  assert.strictEqual(decodeChessableUid('not-a-jwt'), null);
  assert.strictEqual(decodeChessableUid(''), null);
  assert.strictEqual(decodeChessableUid(null), null);
  assert.strictEqual(decodeChessableUid(jwt({ user: { uid: 'x12' } })), null);
});

test('parseCourseNameMap baut bid→Name (camelCase)', () => {
  const data = { homeData: { booksList: [
    { bid: 116242, name: 'Lifetime Repertoires: 1.e4' },
    { bid: 128648, name: 'Short & Sweet' },
  ] } };
  assert.deepStrictEqual(parseCourseNameMap(data), {
    '116242': 'Lifetime Repertoires: 1.e4',
    '128648': 'Short & Sweet',
  });
});

test('parseCourseNameMap toleriert PascalCase-Keys', () => {
  const data = { HomeData: { BooksList: [{ Bid: 1, Name: 'Course One' }] } };
  assert.deepStrictEqual(parseCourseNameMap(data), { '1': 'Course One' });
});

test('parseCourseNameMap überspringt leere Namen und kappt auf 200 Zeichen', () => {
  const long = 'x'.repeat(250);
  const data = { homeData: { booksList: [
    { bid: 1, name: '   ' },
    { bid: 2, name: '  Trim Me  ' },
    { bid: 3, name: long },
  ] } };
  const map = parseCourseNameMap(data);
  assert.strictEqual(map['1'], undefined);
  assert.strictEqual(map['2'], 'Trim Me');
  assert.strictEqual(map['3'].length, 200);
});

test('parseCourseNameMap gibt {} bei fehlender/kaputter Struktur', () => {
  assert.deepStrictEqual(parseCourseNameMap(null), {});
  assert.deepStrictEqual(parseCourseNameMap({}), {});
  assert.deepStrictEqual(parseCourseNameMap({ homeData: {} }), {});
  assert.deepStrictEqual(parseCourseNameMap({ homeData: { booksList: 'nope' } }), {});
});

test('isNavLabel erkennt Modus-/Nav-Labels', () => {
  for (const t of ['Practice', 'Practice Moves', 'Learn Moves', 'Review', 'Overview',
                   'Variations', 'Move Trainer', 'Next', 'Weiter', 'Home']) {
    assert.strictEqual(isNavLabel(t), true, t);
  }
  assert.strictEqual(isNavLabel('  nächstes Kapitel '), true);
  assert.strictEqual(isNavLabel('Previous variation'), true);
});

test('isNavLabel erkennt Leaderboard und Kapitel-Überschriften', () => {
  assert.strictEqual(isNavLabel('Leaderboard'), true);
  assert.strictEqual(isNavLabel('Kapitel 3:'), true);
  assert.strictEqual(isNavLabel('Chapter 12'), true);
  assert.strictEqual(isNavLabel('kapitel:'), true);
});

test('isNavLabel lässt echte Kurstitel durch', () => {
  assert.strictEqual(isNavLabel('Lifetime Repertoires: 1.e4'), false);
  assert.strictEqual(isNavLabel('Learn Chess Openings'), false);
  assert.strictEqual(isNavLabel('Chapter One of My Life'), false);
  assert.strictEqual(isNavLabel(''), false);
  assert.strictEqual(isNavLabel(null), false);
});

// Drift-Guard: die drei Laufzeit-Kopien von isNavLabel (Extension-Activity/-Fen + Userscript)
// hingen schon einmal hinter der Lib zurück und meldeten weiter „Leaderboard"/„Kapitel N" als
// Kursname. Der Test prüft, dass die beiden zuletzt ergänzten Muster überall vorhanden sind.
test('isNavLabel-Kopien in Extension und Userscript sind synchron', () => {
  const root = path.join(__dirname, '..');
  for (const rel of ['extension/chessable-activity.js', 'extension/chessable-fen.js', 'repcheck.user.js']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const i = src.indexOf('function isNavLabel');
    assert.ok(i > 0, rel + ': isNavLabel fehlt');
    const body = src.slice(i, i + 1200);
    assert.ok(body.includes('|leaderboard)$'), rel + ': leaderboard-Filter fehlt');
    assert.ok(body.includes('^(kapitel|chapter)\\s*\\d*\\s*:?$'), rel + ': Kapitel-Filter fehlt');
  }
});
