// ==UserScript==
// @name         RepCheck Chessable-Inspector (Debug)
// @namespace    https://github.com/kahalm/repcheck
// @version      0.1.0
// @description  Diagnose-Werkzeug: sammelt Brett-DOM/Geometrie/Drag-Traces auf chessable.com als JSON (Zwischenablage + Download). NICHT für die Stores — nur zur Fehleranalyse.
// @match        https://www.chessable.com/*
// @match        https://chessable.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Zweck: RepCheck-Features (Zen-Vollbild, FEN-Tools) arbeiten auf Chessables
 * fremdem React-DOM. Dieses Script zieht alles heraus, was man zur Analyse
 * braucht, OHNE DevTools-Handarbeit:
 *   [Snapshot]  – Brett-Ankerkette (Geometrie + relevante Computed-Styles),
 *                 Feld-/Figuren-Beispiele, getrimmtes outerHTML, Viewport/
 *                 Fullscreen-Zustand.
 *   [Record 6s] – zeichnet 6 s lang Pointer-Events + Style-/Klassen-
 *                 Mutationen im Brettbereich + Rechteck der bewegten Figur
 *                 auf (fürs Debuggen von Drag&Drop/Animationen: einfach
 *                 während der Aufnahme eine Figur ziehen).
 * Ergebnis wird in die Zwischenablage kopiert UND als .json heruntergeladen.
 */
(() => {
  'use strict';
  const PANEL_ID = 'repcheck-inspector-panel';
  if (document.getElementById(PANEL_ID)) return;

  // ── Brett-Anker (gleiche Heuristik wie chessable-fen.js) ────────────────
  function boardAnchor() {
    return document.getElementById('board')
      || document.querySelector('[data-square]')?.closest('#board, [class*="chessboard"]')
      || document.querySelector('.cg-wrap, cg-container, [class*="cg-wrap"]')
      || null;
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
  }

  function describe(el) {
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName, id: el.id || null,
      class: String(el.className).slice(0, 200) || null,
      rect: rectOf(el),
      offset: { width: el.offsetWidth, height: el.offsetHeight, left: el.offsetLeft, top: el.offsetTop },
      style: {
        position: cs.position, display: cs.display, zoom: cs.zoom, transform: cs.transform,
        width: cs.width, height: cs.height, overflow: cs.overflow, zIndex: cs.zIndex,
        transition: cs.transition.slice(0, 200), willChange: cs.willChange,
      },
      inlineStyle: (el.getAttribute('style') || '').slice(0, 500) || null,
    };
  }

  function snapshot() {
    const board = boardAnchor();
    const data = {
      kind: 'repcheck-inspector-snapshot',
      when: new Date().toISOString(),
      url: location.href,
      ua: navigator.userAgent,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      fullscreenElement: document.fullscreenElement
        ? document.fullscreenElement.tagName + '#' + (document.fullscreenElement.id || '-')
        : null,
      zenBackdrop: !!document.getElementById('repcheck-zen-backdrop'),
      boardFound: !!board,
      ancestors: [],
      squares: [],
      pieces: [],
      boardOuterHtml: null,
    };
    if (board) {
      let el = board;
      for (let i = 0; el && el !== document.documentElement && i < 10; i++) {
        data.ancestors.push(describe(el));
        el = el.parentElement;
      }
      // Beispiel-Felder (a1/h8-artige Extreme, falls auffindbar) + erste Figuren
      const squares = [...document.querySelectorAll('[data-square]')];
      for (const sq of [squares[0], squares[squares.length - 1]].filter(Boolean)) {
        data.squares.push({ ...describe(sq), html: sq.outerHTML.slice(0, 400) });
      }
      for (const pc of [...document.querySelectorAll('[data-piece], piece')].slice(0, 3)) {
        data.pieces.push({ ...describe(pc), html: pc.outerHTML.slice(0, 400) });
      }
      data.boardOuterHtml = board.outerHTML.slice(0, 30000);
    }
    return data;
  }

  // ── Aufnahme: Pointer + Mutations + Figuren-Rects ───────────────────────
  function record(seconds, done) {
    const board = boardAnchor();
    const trace = {
      kind: 'repcheck-inspector-recording',
      when: new Date().toISOString(),
      seconds,
      snapshotBefore: snapshot(),
      pointer: [], mutations: [], pieceRects: [],
    };
    const t0 = performance.now();
    const ts = () => +(performance.now() - t0).toFixed(1);

    let lastMove = 0;
    const onPointer = (e) => {
      if (e.type === 'pointermove' || e.type === 'mousemove') {
        if (e.timeStamp - lastMove < 30) return;    // ~33 Hz reicht
        lastMove = e.timeStamp;
      }
      const t = e.target instanceof Element ? e.target : null;
      trace.pointer.push({
        t: ts(), type: e.type, x: e.clientX, y: e.clientY,
        target: t ? t.tagName + (t.id ? '#' + t.id : '') + ' ' + String(t.className).slice(0, 80) : null,
      });
    };
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) {
      document.addEventListener(ev, onPointer, { capture: true, passive: true });
    }

    let mo = null;
    if (board) {
      mo = new MutationObserver((muts) => {
        for (const m of muts.slice(0, 20)) {
          const t = m.target instanceof Element ? m.target : null;
          if (!t) continue;
          trace.mutations.push({
            t: ts(), attr: m.attributeName,
            target: t.tagName + ' ' + String(t.className).slice(0, 80),
            value: (t.getAttribute(m.attributeName) || '').slice(0, 200),
          });
        }
        if (trace.mutations.length > 3000) mo.disconnect();
      });
      mo.observe(board, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
    }

    // Das zuletzt angefasste Figuren-Element regelmäßig vermessen (Drag-Pfad).
    const rectTimer = setInterval(() => {
      const dragged = document.querySelector('[data-piece]:hover, piece:hover')
        || document.querySelector('[class*="dragging"], [class*="drag"] [data-piece]');
      if (dragged) trace.pieceRects.push({ t: ts(), rect: rectOf(dragged), class: String(dragged.className).slice(0, 80) });
    }, 100);

    setTimeout(() => {
      for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) {
        document.removeEventListener(ev, onPointer, { capture: true });
      }
      if (mo) mo.disconnect();
      clearInterval(rectTimer);
      done(trace);
    }, seconds * 1000);
  }

  // ── Ausgabe: Zwischenablage + Datei-Download ────────────────────────────
  function deliver(obj, btn, label) {
    const json = JSON.stringify(obj, null, 1);
    try { navigator.clipboard.writeText(json); } catch (e) { /* Download reicht */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `repcheck-inspector-${obj.kind.includes('record') ? 'recording' : 'snapshot'}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    const prev = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = prev; }, 2500);
  }

  // ── Panel ───────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed', bottom: '16px', left: '16px', zIndex: '2147483647',
    display: 'flex', gap: '6px', fontFamily: 'system-ui, sans-serif',
  });
  function mkBtn(text, bg) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    Object.assign(b.style, {
      padding: '6px 10px', fontSize: '12px', background: bg, color: '#fff',
      border: 'none', borderRadius: '6px', cursor: 'pointer', opacity: '0.85',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    });
    return b;
  }
  const snapBtn = mkBtn('RC-Debug: Snapshot', '#455a64');
  snapBtn.addEventListener('click', () => deliver(snapshot(), snapBtn, 'kopiert + Download ✓'));
  const recBtn = mkBtn('Record 6s', '#b71c1c');
  recBtn.addEventListener('click', () => {
    recBtn.textContent = 'zeichnet auf … (jetzt ziehen!)';
    record(6, (trace) => deliver(trace, recBtn, 'kopiert + Download ✓'));
  });
  panel.appendChild(snapBtn);
  panel.appendChild(recBtn);
  document.body.appendChild(panel);
})();
