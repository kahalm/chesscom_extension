// Laeuft als Content-Script in der MAIN-World (siehe manifest.json: world:
// "MAIN") auf chessable.com. Blendet unten rechts zwei Knoepfe ein:
//   - "Copy FEN"   — aktuelle Brettstellung als FEN in die Zwischenablage
//   - "Search FEN" — oeffnet die Chessable-FEN-Suche fuer die Stellung
// und zeigt die zuletzt erspielten XP (nicht Overstudy/Incorrect/Alternative).
//
// MAIN-World ist noetig, weil die zuverlaessige FEN-Quelle die an den Brett-DOM-
// Knoten haengenden React-Fiber-Props sind (`fen`/`interactiveFen`) — die in der
// isolierten Content-Script-Welt NICHT lesbar waeren. Es werden keine chrome.*-
// APIs gebraucht; Clipboard laeuft ueber navigator.clipboard (mit execCommand-
// Fallback). Portiert aus github.com/kahalm/chessable-extension (v0.9.4).
(function () {
  'use strict';

  // Doppel-Init verhindern (z. B. bei mehrfachem Inject).
  if (window.__repcheckChessableFen) return;
  window.__repcheckChessableFen = true;

  // ---------- FEN extraction ----------
  //
  // Chessable nutzt cm-chessboard. Jedes Feld ist ein div mit
  // `data-square="a8"` und enthaelt ein Kind-div mit `data-piece="bR"`
  // (Farbe lowercase: w/b, Rolle uppercase: K Q R B N P).
  // chessground-Fallback bleibt fuer den Fall, dass Chessable die Engine wechselt.

  const CM_PIECE_TO_FEN = {
    wK: 'K', wQ: 'Q', wR: 'R', wB: 'B', wN: 'N', wP: 'P',
    bK: 'k', bQ: 'q', bR: 'r', bB: 'b', bN: 'n', bP: 'p',
  };

  const CG_PIECE_TO_FEN = {
    'white king': 'K', 'white queen': 'Q', 'white rook': 'R',
    'white bishop': 'B', 'white knight': 'N', 'white pawn': 'P',
    'black king': 'k', 'black queen': 'q', 'black rook': 'r',
    'black bishop': 'b', 'black knight': 'n', 'black pawn': 'p',
  };

  function debugDump() {
    const cmSquares = document.querySelectorAll('[data-square]');
    const cmPieces = document.querySelectorAll('[data-piece]');
    const cgBoard = document.querySelector('cg-board, .cg-board, [class*="cg-board"]');
    console.log('[RepCheck Chessable] debug:', {
      url: location.href,
      cmSquaresFound: cmSquares.length,
      cmPiecesFound: cmPieces.length,
      cgBoardFound: !!cgBoard,
      fiberFen: extractFenFromReact(),
      courseId: currentCourseId(),
    });
  }

  // ---- React fiber FEN extraction (preferred) ----

  const FEN_REGEX = /^[1-8rnbqkpRNBQKP/]+\s[wb]\s[KQkqA-Ha-h-]+\s(?:[a-h][1-8]|-)\s\d+\s\d+$/;

  function isValidFen(s) {
    return typeof s === 'string' && FEN_REGEX.test(s.trim());
  }

  function getReactFiber(el) {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  }

  function collectFenCandidates(props, out) {
    if (!props || typeof props !== 'object') return;
    // interactiveFen = Zustand nach einem User-Zug; fen = Lektions-/Basisstellung.
    // Welche zur angezeigten Stellung passt, variiert pro Seite -> beide sammeln
    // und spaeter per DOM-Abgleich auswaehlen.
    if (isValidFen(props.interactiveFen)) out.push(props.interactiveFen.trim());
    if (isValidFen(props.fen)) out.push(props.fen.trim());
  }

  function extractFenFromReact() {
    const anchor = document.getElementById('board')
      || document.querySelector('[data-square]')?.closest('#board, [class*="chessboard"]')
      || document.querySelector('[data-square]');
    if (!anchor) return null;

    let fiber = getReactFiber(anchor);
    if (!fiber) return null;

    const candidates = [];
    let depth = 0;
    while (fiber && depth < 40) {
      collectFenCandidates(fiber.memoizedProps, candidates);
      collectFenCandidates(fiber.pendingProps, candidates);
      fiber = fiber.return;
      depth++;
    }
    if (!candidates.length) return null;

    // Bevorzugt die FEN, deren Figurenstand dem angezeigten Brett entspricht
    // (disambiguiert fen vs. interactiveFen).
    const domPlacement = extractBoardCm();
    if (domPlacement) {
      const matched = candidates.find((c) => c.split(' ')[0] === domPlacement);
      if (matched) return matched;
    }
    return candidates[0];
  }

  // ---- cm-chessboard extraction (Chessable) ----

  function extractBoardCm() {
    const squares = document.querySelectorAll('[data-square]');
    if (!squares.length) return null;

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    let sawAnyPiece = false;

    for (const sq of squares) {
      const name = sq.getAttribute('data-square');
      if (!name || name.length !== 2) continue;
      const file = name.charCodeAt(0) - 'a'.charCodeAt(0);
      const rank = parseInt(name[1], 10) - 1;
      if (file < 0 || file > 7 || rank < 0 || rank > 7) continue;

      const pieceEl = sq.querySelector('[data-piece]');
      if (!pieceEl) continue;
      const fenChar = CM_PIECE_TO_FEN[pieceEl.getAttribute('data-piece')];
      if (!fenChar) continue;

      grid[7 - rank][file] = fenChar;
      sawAnyPiece = true;
    }

    if (!sawAnyPiece) return null;
    return placementFromGrid(grid);
  }

  // ---- chessground extraction (legacy fallback) ----

  function parseTranslate(style) {
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(style);
    if (!m) return null;
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }

  function extractBoardCg() {
    const board = document.querySelector('cg-board, .cg-board, [class*="cg-board"]');
    if (!board) return null;

    const rect = board.getBoundingClientRect();
    const sq = rect.width / 8;
    if (!sq || !isFinite(sq)) return null;

    const wrap = document.querySelector('.cg-wrap, cg-container, [class*="cg-wrap"]');
    let orientation = 'white';
    for (let p = wrap; p; p = p.parentElement) {
      if (p.classList?.contains('orientation-black')) { orientation = 'black'; break; }
      if (p.classList?.contains('orientation-white')) { orientation = 'white'; break; }
    }

    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    const pieces = board.querySelectorAll('piece');
    if (!pieces.length) return null;

    for (const p of pieces) {
      if (p.classList.contains('ghost') || p.classList.contains('fading')) continue;
      const cls = Array.from(p.classList);
      const color = cls.find((c) => c === 'white' || c === 'black');
      const role = cls.find((c) => ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].includes(c));
      if (!color || !role) continue;
      const fenChar = CG_PIECE_TO_FEN[`${color} ${role}`];
      if (!fenChar) continue;

      const t = parseTranslate(p.style.transform || p.getAttribute('style') || '');
      if (!t) continue;

      const colIdx = Math.round(t.x / sq);
      const rowIdx = Math.round(t.y / sq);
      if (colIdx < 0 || colIdx > 7 || rowIdx < 0 || rowIdx > 7) continue;

      const file = orientation === 'white' ? colIdx : 7 - colIdx;
      const rank = orientation === 'white' ? 7 - rowIdx : rowIdx;
      grid[7 - rank][file] = fenChar;
    }

    return placementFromGrid(grid);
  }

  function placementFromGrid(grid) {
    return grid.map((row) => {
      let s = '', empty = 0;
      for (const c of row) {
        if (c === null) empty++;
        else {
          if (empty) { s += empty; empty = 0; }
          s += c;
        }
      }
      if (empty) s += empty;
      return s;
    }).join('/');
  }

  function extractBoard() {
    return extractBoardCm() || extractBoardCg();
  }

  function detectSideToMove() {
    const txt = document.body.innerText || '';
    if (/black\s+to\s+(?:move|play)/i.test(txt)) return 'b';
    if (/white\s+to\s+(?:move|play)/i.test(txt)) return 'w';
    return null;
  }

  function buildFEN() {
    const fiberFen = extractFenFromReact();
    if (fiberFen) return fiberFen;

    const placement = extractBoard();
    if (!placement) return null;
    return `${placement} ${detectSideToMove() || 'w'} KQkq - 0 1`;
  }

  // ---------- Clipboard ----------

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      return true;
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  // ---------- Chessable search URL ----------

  function currentCourseId() {
    const urlM = /\/courses?\/(\d+)(?:\/|$)/.exec(location.pathname);
    if (urlM) return urlM[1];

    for (const a of document.querySelectorAll('a[href*="/course/"]')) {
      const m = /\/course\/(\d+)(?:\/|$)/.exec(a.getAttribute('href') || '');
      if (m) return m[1];
    }

    const anchor = document.getElementById('board') || document.querySelector('[data-square]');
    if (anchor) {
      let fiber = getReactFiber(anchor);
      let depth = 0;
      while (fiber && depth < 60) {
        const id = fiberCourseId(fiber.memoizedProps) || fiberCourseId(fiber.pendingProps);
        if (id) return id;
        fiber = fiber.return;
        depth++;
      }
    }
    return null;
  }

  function fiberCourseId(props) {
    if (!props || typeof props !== 'object') return null;
    const candidates = [
      props.courseId, props.courseID, props.course_id,
      props.course?.id, props.course?.courseId,
    ];
    for (const c of candidates) {
      if (c != null && /^\d+$/.test(String(c))) return String(c);
    }
    return null;
  }

  function chessableSearchUrl(fen) {
    const courseId = currentCourseId();
    if (courseId) {
      // Kursinterne FEN-Suche: "/" -> ";", " " -> %20. Restliche FEN-Zeichen sind
      // URL-sicher, daher KEIN encodeURIComponent (das wuerde ";" zu %3B machen).
      const encoded = fen.replace(/\//g, ';').replace(/ /g, '%20');
      return `https://www.chessable.com/course/${courseId}/fen/${encoded}/`;
    }
    // Fallback (keine Kurs-ID): globale FEN-Suche, "/" -> "U".
    const encoded = fen.replace(/\//g, 'U').replace(/ /g, '%20');
    return `https://www.chessable.com/courses/fen/${encoded}/`;
  }

  // ---------- Points tracker ----------
  //
  // Beobachtet <span data-testid="moveNotification">. Steht da "XP", wird der
  // Wert aus dem Geschwister-<span class="current-points"> gelesen.
  // "Overstudied"/"Incorrect"/"Alternative" werden ignoriert.

  let lastXP = null;
  let pointsObserver = null;
  let watchedNotif = null;

  function initPointsTracker() {
    const notif = document.querySelector('[data-testid="moveNotification"]');
    if (!notif) return;

    if (watchedNotif && watchedNotif !== notif) {
      pointsObserver?.disconnect();
      pointsObserver = null;
    }
    if (pointsObserver) return;
    watchedNotif = notif;

    pointsObserver = new MutationObserver(() => {
      if (notif.textContent.trim() === 'XP') {
        const pointsEl = document.querySelector('span.current-points');
        if (pointsEl) {
          lastXP = pointsEl.textContent.replace(/[\s ]+/g, '');
          updatePointsDisplay();
        }
      }
    });
    pointsObserver.observe(notif, { childList: true, characterData: true, subtree: true });
  }

  function updatePointsDisplay() {
    const el = document.getElementById('repcheck-chessable-last-xp');
    if (!el || !lastXP) return;
    el.textContent = lastXP + ' XP';
    el.style.display = 'inline-block';
  }

  function hidePointsDisplay() {
    const el = document.getElementById('repcheck-chessable-last-xp');
    if (el) el.style.display = 'none';
  }

  // ---------- UI ----------

  const CONTAINER_ID = 'repcheck-chessable-fen-tools';
  const COPY_BTN_ID = 'repcheck-chessable-fen-copy-btn';
  const SEARCH_BTN_ID = 'repcheck-chessable-fen-search-btn';

  function styleButton(btn, bg) {
    Object.assign(btn.style, {
      padding: '8px 12px',
      fontSize: '13px',
      fontFamily: 'system-ui, sans-serif',
      background: bg,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      cursor: 'pointer',
      opacity: '0.9',
    });
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.9'; });
  }

  // Mobile: die Floating-Buttons kollidieren unten mit der Firefox-/System-
  // Leiste. Auf schmalen Screens daher höher setzen (+ Safe-Area) und umbrechen
  // lassen. !important, weil die Basis-Position als Inline-Style gesetzt ist.
  const MOBILE_STYLE_ID = 'repcheck-chessable-fen-mobile-style';
  function injectMobileStyle() {
    if (document.getElementById(MOBILE_STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = MOBILE_STYLE_ID;
    st.textContent = `
      @media (max-width: 768px) {
        #${CONTAINER_ID} {
          bottom: calc(env(safe-area-inset-bottom, 0px) + 88px) !important;
          right: calc(env(safe-area-inset-right, 0px) + 8px) !important;
          left: 8px !important;
          flex-wrap: wrap !important;
          justify-content: flex-end !important;
          gap: 6px !important;
        }
        #${CONTAINER_ID} button { padding: 6px 10px !important; font-size: 12px !important; }
      }`;
    (document.head || document.documentElement).appendChild(st);
  }

  // ── Vollbild-/Zen-Modus ─────────────────────────────────────────────────
  // Ganze Seite in echtes Vollbild, das Brett groß und mittig auf dunklem
  // Backdrop. Bewusst KEIN DOM-Umbau (Chessable ist React — Knoten verschieben
  // bricht die Reconciliation): das Brett bekommt nur Inline-Styles, der Rest
  // der Seite verschwindet hinter einem eigenen Backdrop-DIV. Die RepCheck-
  // Buttons liegen über dem Backdrop → der Knopf selbst (oder Esc) führt raus.
  //
  // Vergrößert wird OHNE zoom/transform:scale — beides bricht das Drag&Drop
  // von chessboard.js: die Feld-Offsets werden beim Drag-Start VISUELL
  // gemessen (getBoundingClientRect-basiert, also mitskaliert), die Treffer-
  // Prüfung rechnet aber mit der LAYOUT-squareSize → jede Feld-Hitbox deckt
  // nur einen Teil des Felds, Drops in der toten Zone enden als Snapback
  // (per Inspector-Trace belegt). Stattdessen: width/height des Bretts per
  // !important auf die Zielgröße festnageln und Chessables eigenen Resize-
  // Pfad anstoßen (resize-Event) — der ruft board.resize() auf, chessboard.js
  // berechnet die squareSize echt neu, und Maus- wie Brettkoordinaten leben
  // wieder im selben System.
  const ZEN_BACKDROP_ID = 'repcheck-zen-backdrop';
  const ZEN_STYLE_ID = 'repcheck-zen-style';
  let zenBoard = null;
  let zenPrevStyle = '';
  let zenRescale = null;
  let zenApplied = 0;
  let zenPokeTimer = null;
  // Zen-only-Buttons (▸ Next, 💬 Kommentar-Panel) + gehobenes Panel-Element.
  let zenNextBtn = null;
  let zenPanelBtn = null;
  let zenPanelEl = null;
  let zenPanelPrevStyle = '';

  function zenTarget() {
    return document.getElementById('board')
      || document.querySelector('[data-square]')?.closest('#board, [class*="chessboard"]')
      || document.querySelector('.cg-wrap, cg-container, [class*="cg-wrap"]')
      || null;
  }

  function zenActive() { return !!document.getElementById(ZEN_BACKDROP_ID); }

  // Chessables Resize-Handler (debounced) anstoßen, damit chessboard.js die
  // squareSize an die neue Brettgröße anpasst. Wird nur bei geänderter
  // Zielgröße gerufen → keine Event-Schleife mit dem eigenen resize-Listener.
  function zenPokeLayout() {
    if (zenPokeTimer) return;
    zenPokeTimer = setTimeout(() => {
      zenPokeTimer = null;
      window.dispatchEvent(new Event('resize'));
    }, 60);
  }

  function enterZen(btn) {
    const board = zenTarget();
    const rect = board && board.getBoundingClientRect();
    if (!board || !rect || !rect.width) { flash(btn, 'No board found', '#c62828'); return; }
    zenBoard = board;
    zenPrevStyle = board.getAttribute('style') || '';

    const backdrop = document.createElement('div');
    backdrop.id = ZEN_BACKDROP_ID;
    Object.assign(backdrop.style, {
      position: 'fixed', inset: '0', background: '#111', zIndex: '2147483600',
    });
    backdrop.addEventListener('click', () => exitZen());
    document.body.appendChild(backdrop);

    // chessboard.js hängt die gezogene Schwebefigur an <body> — die muss ÜBER
    // das Backdrop, sonst ist die Figur während des Ziehens unsichtbar.
    // (.piece-417db ist eine chessboard.js-Konstante, kein generierter Hash.)
    if (!document.getElementById(ZEN_STYLE_ID)) {
      const st = document.createElement('style');
      st.id = ZEN_STYLE_ID;
      st.textContent = 'body > .piece-417db { z-index: 2147483620 !important; }';
      (document.head || document.documentElement).appendChild(st);
    }

    zenApplied = 0;
    zenRescale = () => {
      const target = Math.floor(0.97 * Math.min(window.innerWidth, window.innerHeight));
      // !important, weil Chessables eigener Resize-Handler style.width neu
      // setzt (fit-height-Berechnung): unsere Größe muss gewinnen — sein
      // board.resize() liest danach die tatsächliche (= unsere) Breite und
      // zeichnet die Felder in der neuen Größe.
      const s = zenBoard.style;
      s.setProperty('position', 'fixed', 'important');
      s.setProperty('left', '50%', 'important');
      s.setProperty('top', '50%', 'important');
      s.setProperty('margin', '0', 'important');
      s.setProperty('transform', 'translate(-50%, -50%)', 'important');
      s.setProperty('z-index', '2147483610', 'important');
      for (const p of ['width', 'height', 'max-width', 'max-height']) {
        s.setProperty(p, target + 'px', 'important');
      }
      if (target !== zenApplied) { zenApplied = target; zenPokeLayout(); }
    };
    zenRescale();
    window.addEventListener('resize', zenRescale);

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    updateZenButton();
  }

  function exitZen() {
    document.getElementById(ZEN_BACKDROP_ID)?.remove();
    document.getElementById(ZEN_STYLE_ID)?.remove();
    zenPanelHide();
    if (zenPokeTimer) { clearTimeout(zenPokeTimer); zenPokeTimer = null; }
    if (zenRescale) { window.removeEventListener('resize', zenRescale); zenRescale = null; }
    if (zenBoard) {
      if (zenPrevStyle) zenBoard.setAttribute('style', zenPrevStyle);
      else zenBoard.removeAttribute('style');
      zenBoard = null;
    }
    // Chessable-Layout zurück auf Normalgröße rechnen lassen (board.resize()).
    window.dispatchEvent(new Event('resize'));
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    updateZenButton();
  }

  // ── Zen-Extras: ▸ Next-Klick + 💬 Kommentar-/Zugspalte ──────────────────
  // Chessables eigener „Next"-Knopf liegt im Zen-Modus hinterm Backdrop —
  // der ▸-Button sucht ihn per Text und klickt ihn programmatisch (React
  // bekommt ein echtes click-Event, Sichtbarkeit spielt dafür keine Rolle).
  function clickChessableNext(btn) {
    const cand = [...document.querySelectorAll('button, a, [role="button"]')].find((el) => {
      if (el.closest('#' + CONTAINER_ID)) return false;
      const t = (el.textContent || '').trim();
      if (!/^(next( variation| chapter| move| line)?|weiter)$/i.test(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (cand) cand.click();
    else flash(btn, 'Kein „Next" da', '#c62828');
  }

  // Kommentar-/Zugspalte finden: die Geschwister-Spalte der Brett-Spalte im
  // Practice-Layout (row-practice__col*) mit dem meisten Text — dort wohnen
  // die Kommentare + Zugliste, die man sonst am Linienende sieht.
  function zenPanelTarget() {
    const board = zenBoard || zenTarget();
    const boardCol = board && board.closest('[class*="__col"]');
    const row = boardCol && boardCol.parentElement;
    if (!row) return null;
    let best = null;
    for (const el of row.children) {
      if (el === boardCol) continue;
      if (el.getBoundingClientRect().width < 120) continue;
      if (!best || (el.textContent || '').length > (best.textContent || '').length) best = el;
    }
    return best;
  }

  function zenPanelShow(btn) {
    const panel = zenPanelTarget();
    if (!panel) { flash(btn, 'Kein Panel gefunden', '#c62828'); return; }
    zenPanelEl = panel;
    zenPanelPrevStyle = panel.getAttribute('style') || '';
    // Rechts neben dem zentrierten Brett andocken; Breite = rechter
    // Randstreifen (280–460px), notfalls leicht übers Brett (z-Index höher).
    const boardRect = zenBoard ? zenBoard.getBoundingClientRect() : null;
    const gutter = boardRect ? window.innerWidth - boardRect.right - 24 : 380;
    const w = Math.round(Math.min(460, Math.max(280, gutter)));
    const s = panel.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('top', '50%', 'important');
    s.setProperty('right', '12px', 'important');
    s.setProperty('transform', 'translateY(-50%)', 'important');
    s.setProperty('width', w + 'px', 'important');
    s.setProperty('max-height', '92vh', 'important');
    s.setProperty('overflow-y', 'auto', 'important');
    s.setProperty('z-index', '2147483615', 'important');
    s.setProperty('margin', '0', 'important');
    s.setProperty('padding', '12px', 'important');
    s.setProperty('border-radius', '10px', 'important');
    s.setProperty('box-shadow', '0 4px 24px rgba(0,0,0,0.5)', 'important');
    // Transparente Panels bekommen auf dem dunklen Backdrop einen zur
    // Textfarbe passenden Grund (helle Schrift → dunkel, dunkle → hell).
    const cs = getComputedStyle(panel);
    if (!cs.backgroundColor || cs.backgroundColor === 'transparent' || /rgba\([^)]*,\s*0\)\s*$/.test(cs.backgroundColor)) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.color || '');
      const lightText = m && (+m[1] + +m[2] + +m[3]) / 3 > 128;
      s.setProperty('background', lightText ? '#1e1e1e' : '#fafafa', 'important');
    }
  }

  function zenPanelHide() {
    if (!zenPanelEl) return;
    if (zenPanelPrevStyle) zenPanelEl.setAttribute('style', zenPanelPrevStyle);
    else zenPanelEl.removeAttribute('style');
    zenPanelEl = null;
  }

  function toggleZenPanel(btn) {
    if (zenPanelEl) zenPanelHide();
    else zenPanelShow(btn);
  }

  // Esc beendet nur das Browser-Vollbild — dann auch den Zen-Zustand abbauen.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && zenActive()) exitZen();
  });

  function updateZenButton() {
    const btn = btnRefs.fullscreen;
    if (btn) {
      btn.textContent = zenActive() ? '✕' : '⛶';
      btn.title = zenActive() ? 'Vollbild verlassen (Esc)' : 'Brett bildschirmfüllend (Esc beendet)';
    }
    // Im Zen-Modus bleiben Exit, Refresh und die Zen-Extras (▸/💬) sichtbar.
    // Beim Verlassen stellt applyButtonSettings() die Popup-Einstellungen
    // wieder her; die Zen-Extras werden explizit versteckt (nicht in btnRefs).
    const wrap = document.getElementById(CONTAINER_ID);
    if (!wrap) return;
    if (zenActive()) {
      for (const child of wrap.children) {
        const keep = child === btn || child === btnRefs.refresh || child === zenNextBtn || child === zenPanelBtn;
        child.style.display = keep ? '' : 'none';
      }
    } else {
      if (zenNextBtn) zenNextBtn.style.display = 'none';
      if (zenPanelBtn) zenPanelBtn.style.display = 'none';
      applyButtonSettings();
    }
  }

  function createUi() {
    if (document.getElementById(CONTAINER_ID)) return;
    injectMobileStyle();

    const wrap = document.createElement('div');
    wrap.id = CONTAINER_ID;
    Object.assign(wrap.style, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '2147483647',
      display: 'flex',
      gap: '8px',
    });

    const copyBtn = document.createElement('button');
    copyBtn.id = COPY_BTN_ID;
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy FEN';
    styleButton(copyBtn, '#2e7d32');
    copyBtn.addEventListener('click', () => {
      const fen = buildFEN();
      if (!fen) { flash(copyBtn, 'No board found', '#c62828'); debugDump(); return; }
      if (copyToClipboard(fen)) {
        flash(copyBtn, 'Copied!', '#1565c0');
        console.log('[RepCheck Chessable]', fen);
      } else {
        flash(copyBtn, 'Copy failed', '#c62828');
        console.log('[RepCheck Chessable] FEN (manual copy):', fen);
      }
    });

    const analyseBtn = document.createElement('button');
    analyseBtn.type = 'button';
    analyseBtn.textContent = 'Analyse';
    analyseBtn.title = 'Stellung in RookHub analysieren (neuer Tab)';
    styleButton(analyseBtn, '#00695c');
    analyseBtn.addEventListener('click', () => {
      const fen = buildFEN();
      if (!fen) { flash(analyseBtn, 'No board found', '#c62828'); debugDump(); return; }
      if (!rookhubBaseUrl) { requestRookhubUrl(); flash(analyseBtn, 'Set RookHub URL', '#c62828'); return; }
      const orient = fen.split(' ')[1] === 'b' ? 'black' : 'white';   // Brett aus Sicht der Seite am Zug
      const url = rookhubBaseUrl.replace(/\/$/, '') + '/analysis?fen=' + encodeURIComponent(fen) + '&orientation=' + orient;
      console.log('[RepCheck Chessable Analyse]', fen, '->', url);
      const win = window.open(url, '_blank', 'noopener');
      if (!win) flash(analyseBtn, 'Popup blocked', '#c62828');
    });

    const searchBtn = document.createElement('button');
    searchBtn.id = SEARCH_BTN_ID;
    searchBtn.type = 'button';
    searchBtn.textContent = 'Search FEN';
    styleButton(searchBtn, '#1565c0');
    searchBtn.addEventListener('click', () => {
      const fen = buildFEN();
      if (!fen) { flash(searchBtn, 'No board found', '#c62828'); debugDump(); return; }
      const url = chessableSearchUrl(fen);
      console.log('[RepCheck Chessable Search]', fen, '->', url);
      const win = window.open(url, '_blank', 'noopener');
      if (!win) flash(searchBtn, 'Popup blocked', '#c62828');
    });

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Refresh';
    styleButton(refreshBtn, '#616161');
    refreshBtn.title = 'Seite neu laden';
    refreshBtn.addEventListener('click', () => {
      window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); delete e.returnValue; }, { capture: true, once: true });
      location.reload();
    });

    const rememberBtn = document.createElement('button');
    rememberBtn.type = 'button';
    rememberBtn.textContent = REMEMBER_LABEL;
    styleButton(rememberBtn, '#6a1b9a');
    rememberBtn.title = 'Stellung in RookHub merken';
    rememberBtn.addEventListener('click', () => rememberLine(rememberBtn));

    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.type = 'button';
    fullscreenBtn.textContent = '⛶';   // kompaktes Vollbild-Symbol statt Text-Button
    styleButton(fullscreenBtn, '#37474f');
    Object.assign(fullscreenBtn.style, { fontSize: '15px', lineHeight: '1', padding: '8px 10px' });
    fullscreenBtn.title = 'Brett bildschirmfüllend (Esc beendet)';
    fullscreenBtn.addEventListener('click', () => { zenActive() ? exitZen() : enterZen(fullscreenBtn); });

    // Zen-only: ▸ klickt Chessables „Next", 💬 holt die Kommentar-/Zugspalte
    // vor das Backdrop. Außerhalb des Zen-Modus unsichtbar; bewusst NICHT in
    // btnRefs (keine Popup-Toggles dafür).
    const zNext = document.createElement('button');
    zNext.type = 'button';
    zNext.textContent = '▸';
    zNext.title = 'Next (nächste Variante/Kapitel)';
    styleButton(zNext, '#2e7d32');
    Object.assign(zNext.style, { fontSize: '15px', lineHeight: '1', padding: '8px 10px', display: 'none' });
    zNext.addEventListener('click', () => clickChessableNext(zNext));
    zenNextBtn = zNext;

    const zPanel = document.createElement('button');
    zPanel.type = 'button';
    zPanel.textContent = '💬';
    zPanel.title = 'Kommentare/Züge ein-/ausblenden';
    styleButton(zPanel, '#455a64');
    Object.assign(zPanel.style, { fontSize: '15px', lineHeight: '1', padding: '8px 10px', display: 'none' });
    zPanel.addEventListener('click', () => toggleZenPanel(zPanel));
    zenPanelBtn = zPanel;

    // XP-Anzeige vorerst deaktiviert (kommt später wieder) — Badge + Tracker aus.
    btnRefs = { copyFen: copyBtn, analyse: analyseBtn, searchFen: searchBtn, refresh: refreshBtn, remember: rememberBtn, fullscreen: fullscreenBtn };
    wrap.appendChild(copyBtn);
    wrap.appendChild(analyseBtn);
    wrap.appendChild(searchBtn);
    wrap.appendChild(refreshBtn);
    wrap.appendChild(rememberBtn);
    wrap.appendChild(zPanel);
    wrap.appendChild(zNext);
    wrap.appendChild(fullscreenBtn);
    document.body.appendChild(wrap);
    applyButtonSettings();     // je nach Popup-Einstellung ein-/ausblenden
    requestButtonSettings();   // aktuelle Einstellung aus der isolierten Welt anfordern
    // RookHub-URL aus der isolierten Welt (chessable-activity.js) anfordern, damit der
    // Analyse-Button beim Klick synchron einen neuen Tab öffnen kann (Popup-Blocker-sicher).
    requestRookhubUrl();
  }

  // ---- Pro-Button-Sichtbarkeit (im Popup einstellbar) ----
  // Welche der FEN-Tool-Buttons erscheinen, ist im Extension-Popup pro Button umschaltbar
  // (chrome.storage.local `chessableButtons`). chessable-fen.js läuft in der MAIN-World ohne
  // chrome.*-Zugriff → chessable-activity.js (isoliert) spiegelt die Einstellung per postMessage
  // hierher (Same-Window + Same-Origin geprüft; kein Secret).
  let btnRefs = {};
  let buttonSettings = { copyFen: true, analyse: true, searchFen: true, refresh: true, remember: true, fullscreen: true };
  function applyButtonSettings() {
    for (const key of Object.keys(btnRefs)) {
      const btn = btnRefs[key];
      if (btn) btn.style.display = (buttonSettings[key] === false) ? 'none' : '';
    }
  }
  function requestButtonSettings() {
    window.postMessage({ __repcheck: 'request-chessable-buttons' }, location.origin);
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.__repcheck !== 'chessable-buttons') return;
    const s = e.data.settings;
    if (s && typeof s === 'object') { buttonSettings = Object.assign({ copyFen: true, analyse: true, searchFen: true, refresh: true, remember: true, fullscreen: true }, s); applyButtonSettings(); }
  });

  // Die RookHub-URL liegt extension-privat in chrome.storage.local (nur isolierte Welt lesbar);
  // chessable-activity.js spiegelt sie hierher, damit der Analyse-Button sie synchron im
  // Klick-Handler hat. Nur Same-Window + Same-Origin akzeptieren (Defense-in-Depth; die URL ist
  // kein Secret, der Token bleibt in der isolierten Welt).
  let rookhubBaseUrl = null;
  function requestRookhubUrl() {
    window.postMessage({ __repcheck: 'request-rookhub-url' }, location.origin);
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.__repcheck !== 'rookhub-url') return;
    if (typeof e.data.url === 'string' && e.data.url) rookhubBaseUrl = e.data.url;
  });

  // „Remember line": FEN + Kontext per window.postMessage an die isolierte Welt
  // (chessable-activity.js), die den Egress mit RookHub-Config + Background-Worker
  // erledigt — so bleibt der Token aus dem Page-Kontext. postMessage ist der
  // robuste MAIN↔isoliert-Kanal (CustomEvent-detail ist in Firefox heikel).
  const REMEMBER_LABEL = 'Remember line';
  let pendingRememberBtn = null;

  function rememberLine(btn) {
    const fen = buildFEN();
    if (!fen) { flash(btn, 'No board found', '#c62828'); debugDump(); return; }
    pendingRememberBtn = btn;
    btn.textContent = 'Saving…';
    btn.disabled = true;
    window.postMessage({
      __repcheck: 'remember-line',
      fen, courseId: currentCourseId(), sourceUrl: location.href,
    }, location.origin);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.__repcheck !== 'remember-line-result') return;
    const btn = pendingRememberBtn;
    pendingRememberBtn = null;
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = REMEMBER_LABEL;
    flash(btn, e.data.ok ? 'Remembered!' : (e.data.error || 'Failed'), e.data.ok ? '#2e7d32' : '#c62828');
  });

  function flash(btn, text, color) {
    const oldText = btn.textContent;
    const oldBg = btn.style.background;
    btn.textContent = text;
    btn.style.background = color;
    setTimeout(() => {
      btn.textContent = oldText;
      btn.style.background = oldBg;
    }, 1200);
  }

  // XP zuruecksetzen, wenn der User "Next variation" klickt.
  let nextVarListenerAttached = false;

  function attachNextVariationListener() {
    if (nextVarListenerAttached) return;
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button, a, [role="button"]');
      if (!btn) return;
      if (/^Next\s*(variation)?$/i.test(btn.textContent.trim())) {
        lastXP = null;
        hidePointsDisplay();
      }
    }, true);
    nextVarListenerAttached = true;
  }

  // Seit v1.14.0: die FEN-Tools erscheinen NUR im Practice-Mode
  // (chessable.com/practice/…) — auf Kurs-Übersichten/Buch-Seiten o. Ä. nicht.
  function isPracticeMode() {
    return /^\/practice(\/|$)/.test(location.pathname);
  }

  function removeUi() {
    document.getElementById(CONTAINER_ID)?.remove();
    pointsObserver?.disconnect();
    pointsObserver = null;
    watchedNotif = null;
  }

  function ensureUi() {
    if (!isPracticeMode()) { removeUi(); return; }
    createUi();
    // XP-Tracker vorerst deaktiviert (kommt später wieder):
    //   initPointsTracker(); attachNextVariationListener(); if (lastXP) updatePointsDisplay();
  }

  if (document.body) ensureUi();
  else document.addEventListener('DOMContentLoaded', ensureUi, { once: true });

  // UI ueber SPA-Navigationen am Leben halten. Verlaesst der User den
  // Practice-Mode (SPA-Nav), wird die UI wieder entfernt.
  const mo = new MutationObserver(() => {
    if (!isPracticeMode()) { removeUi(); return; }
    if (!document.getElementById(CONTAINER_ID)) ensureUi();
    // initPointsTracker(); // XP-Tracker vorerst deaktiviert
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Navigations-/UI-Linktexte auf der Practice-/Learn-Seite, die KEIN Kursname sind
  // (z. B. „Practice Moves", „Learn Moves", „Review", „nächstes Kapitel", „Previous variation").
  // Diese Links/Labels zeigen ebenfalls auf /course/{id}/… bzw. beschriften den Modus und haben
  // sonst den echten Titel verdrängt (Beispiel: gemeldeter Kursname „Practice Moves"/„Learn Moves").
  function isNavLabel(txt) {
    const t = txt.toLowerCase().trim();
    // Eigenständige Nav-/Modus-/UI-Labels (exakter Match — echte Titel wie „Learn Chess Openings" bleiben).
    if (/^(practice( moves)?|learn( moves)?|review|overview|variations?|move ?trainer|next|previous|prev|continue|weiter|home)$/.test(t)) return true;
    // „Next/Previous chapter|variation|move|line" bzw. deutsche Entsprechungen.
    if (/^(next|previous|prev|nächst\w*|naechst\w*|vorherig\w*|vorig\w*|letzt\w*)\b/.test(t)
        && /(chapter|variation|move|line|kapitel|variante|zug|linie)/.test(t)) return true;
    return false;
  }

  // Kursname aus den React-Fiber-Props (autoritativ, gleiche Quelle wie die verlässliche Kurs-ID):
  // das `course`-Objekt trägt neben `id` auch `name`/`title`. Deutlich robuster als Seitentext,
  // der im Practice-/Learn-Modus nur das Modus-Label liefert.
  function fiberCourseName(props) {
    if (!props || typeof props !== 'object') return null;
    const candidates = [
      props.course?.name, props.course?.title, props.course?.courseName,
      props.courseName, props.courseTitle,
      props.book?.name, props.book?.title,
    ];
    for (const c of candidates) {
      if (typeof c !== 'string') continue;
      const t = c.replace(/\s+/g, ' ').trim();
      if (t && t.length <= 200 && !isNavLabel(t)) return t;
    }
    return null;
  }

  // Lesbarer Kursname: bevorzugt den echten Titel aus dem React-Fiber; sonst der beschreibendste
  // Kurs-Linktext (Nav-/Modus-Labels werden verworfen), zuletzt document.title.
  function currentCourseName() {
    const anchor = document.getElementById('board') || document.querySelector('[data-square]');
    if (anchor) {
      let fiber = getReactFiber(anchor), depth = 0;
      while (fiber && depth < 60) {
        const n = fiberCourseName(fiber.memoizedProps) || fiberCourseName(fiber.pendingProps);
        if (n) return n;
        fiber = fiber.return; depth++;
      }
    }
    const id = currentCourseId();
    if (id) {
      const candidates = [];
      for (const a of document.querySelectorAll('a[href*="/course/' + id + '/"]')) {
        const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt && txt.length <= 200 && !isNavLabel(txt)) candidates.push(txt);
      }
      // Kurstitel ist i. d. R. der längste, beschreibende Linktext (Nav-Labels sind raus).
      if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];
    }
    const t = (document.title || '').replace(/\s*[|\-–]\s*Chessable.*$/i, '').trim();
    return t || null;
  }

  // Kurs-ID (+ Name) an die isolierte Welt (chessable-activity.js) spiegeln: dort ist der
  // React-Fiber nicht lesbar und die Practice-URL (/practice/…) traegt keine Kurs-ID.
  // Nur bei Aenderung posten (kein Spam); deckt initiales Laden + SPA-Navigation ab.
  let lastBroadcastCourseId = null;
  let lastBroadcastCourseName = null;
  function broadcastCourseId() {
    const id = currentCourseId();
    const name = currentCourseName();
    if (id === lastBroadcastCourseId && name === lastBroadcastCourseName) return;
    lastBroadcastCourseId = id;
    lastBroadcastCourseName = name;
    window.postMessage({ __repcheck: 'course-id', courseId: id, courseName: name }, location.origin);
  }
  broadcastCourseId();
  setInterval(broadcastCourseId, 5000);

  console.log('[RepCheck Chessable] FEN-Tools aktiv');
})();
