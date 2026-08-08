'use strict';
// Geteilter Kern der Chessable-Kursnamen-Auflösung: JWT-uid-Decode, getHomeData-Parsing und der
// Nav-Label-Filter. EINE Quelle für beide Distributionen (vorher: testbare Spiegel-Datei plus
// drei hand-gepflegte Laufzeit-Kopien, die auseinanderliefen):
//   - Extension: wird per manifest.json als Content-Script geladen, und zwar VOR
//     chessable-activity.js (isolierte Welt) UND vor chessable-fen.js (MAIN-World); beide holen
//     sich die Funktionen über `self.RepCheckCourseNames`.
//   - Userscript: build/assemble.mjs kopiert den Kern zwischen die Sentinel-Marker
//     `>>>REPCHECK-SHARED:chessable-course-names` in repcheck.user.js (dort stehen die
//     Funktionen einfach im IIFE-Scope).
//
// Die `rc`-Präfixe sind kein Zierrat: in der MAIN-World landen Top-Level-Deklarationen im
// `window` der Seite — ein generisches `isNavLabel` würde sich dort mit Seitencode ins Gehege
// kommen. Gleiche Konvention wie lib/i18n.js (`rcTranslate` …).

// Base64url → String (Padding ergänzen). atob existiert in Node ≥16 global.
function rcB64UrlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

// uid steckt im JWT-Payload unter user.uid (wie piratechess/JwtHelper). Gibt die uid als
// String zurück oder null (leerer/kaputter Token, fehlende uid).
function rcDecodeChessableUid(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const o = JSON.parse(rcB64UrlDecode(parts[1]));
    const uid = o && o.user && o.user.uid;
    return (uid != null && /^\d+$/.test(String(uid))) ? String(uid) : null;
  } catch (e) { return null; }
}

// getHomeData-Antwort → { bid(string): name }. Toleriert camelCase/PascalCase-Keys und
// numerische/String-bids; überspringt leere Namen; kappt auf 200 Zeichen.
function rcParseCourseNameMap(data) {
  const home = data && (data.homeData || data.HomeData);
  const books = home && (home.booksList || home.BooksList);
  if (!Array.isArray(books)) return {};
  const map = {};
  for (const b of books) {
    const bid = b && (b.bid != null ? b.bid : b.Bid);
    const name = b && (b.name != null ? b.name : b.Name);
    if (bid != null && typeof name === 'string' && name.trim())
      map[String(bid)] = name.trim().slice(0, 200);
  }
  return map;
}

// Navigations-/Modus-/UI-Labels, die KEIN Kursname sind. Die Falle: solche Links zeigen ebenfalls
// auf /course/{id}/… und verdrängten deshalb den echten Titel — gemeldet wurden „Practice Moves",
// „Leaderboard" oder „Kapitel 3:" als Kursname.
function rcIsNavLabel(txt) {
  const t = String(txt || '').toLowerCase().trim();
  // Eigenständige Nav-/Modus-/UI-Labels (exakter Match — echte Titel wie „Learn Chess Openings" bleiben).
  if (/^(practice( moves)?|learn( moves)?|review|overview|variations?|move ?trainer|next|previous|prev|continue|weiter|home|leaderboard)$/.test(t)) return true;
  // „Next/Previous chapter|variation|move|line" bzw. deutsche Entsprechungen.
  if (/^(next|previous|prev|nächst\w*|naechst\w*|vorherig\w*|vorig\w*|letzt\w*)\b/.test(t)
      && /(chapter|variation|move|line|kapitel|variante|zug|linie)/.test(t)) return true;
  // Kapitel-Überschriften („Kapitel 3:", „Chapter 12") — Seitentext, kein Kurstitel.
  if (/^(kapitel|chapter)\s*\d*\s*:?$/.test(t)) return true;
  return false;
}

// Node/CommonJS-Export (Tests) + Browser-Global (Content-Scripts). Im Userscript steht der Kern
// direkt im IIFE-Scope, dort greift keiner der beiden Zweige.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rcB64UrlDecode, rcDecodeChessableUid, rcParseCourseNameMap, rcIsNavLabel };
}
if (typeof self !== 'undefined') {
  self.RepCheckCourseNames = {
    decodeChessableUid: rcDecodeChessableUid,
    parseCourseNameMap: rcParseCourseNameMap,
    isNavLabel: rcIsNavLabel,
  };
}
