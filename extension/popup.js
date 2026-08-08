// Popup-Logik: zeigt den Cache-Status und triggert das Content-Script auf
// Klick. Seit v1.4.8 wird das Content-Script NICHT mehr automatisch in
// chess.com-Tabs geladen, sondern erst hier via chrome.scripting.executeScript.

const STATUS_EL = document.getElementById('status');
const ERROR_EL = document.getElementById('error-hint');
const REP_EL = document.getElementById('repertoires');

// ─── Sprache ───────────────────────────────────────────────────────────
// Alle sichtbaren Texte kommen aus der geteilten Tabelle lib/i18n.js (self.RepCheckI18n,
// wird in popup.html VOR dieser Datei geladen). `rcLang` ist die aktive Sprache,
// `rcLangStored` die ausdrückliche Wahl des Nutzers ('' = automatisch nach Browsersprache).
let rcLang = self.RepCheckI18n.resolveLang(null, navigator.languages);
let rcLangStored = '';
function t(key, params) { return self.RepCheckI18n.translate(rcLang, key, params); }

// Die Sprachnamen im Auswahlfeld bleiben in ihrer eigenen Sprache (Konvention, kein Schlüssel).
const LANG_NAMES = { en: 'English', de: 'Deutsch', hr: 'Hrvatski' };
const LANG_SELECT = document.getElementById('lang-select');

// Statische Beschriftungen aus dem HTML (data-i18n / -title / -placeholder) neu setzen.
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.documentElement.lang = rcLang;
  if (LANG_SELECT) {
    const auto = self.RepCheckI18n.resolveLang(null, navigator.languages);
    const autoOpt = LANG_SELECT.querySelector('option[value=""]');
    if (autoOpt) autoOpt.textContent = t('lang.auto', { lang: LANG_NAMES[auto] || auto });
    LANG_SELECT.value = rcLangStored;
  }
}

// Beschriftet das ganze Popup neu — statisches Gerüst plus die zur Laufzeit gesetzten Texte,
// die dafür ihren letzten Zustand (Schlüssel + Parameter) merken statt fertiger Strings.
function repaintAll() {
  applyI18n(document);
  paintStatus();
  renderRepertoireList(repItems);
  paintShareState();
  paintChessableState();
  // ciRender(null) hieße „Content-Script nicht bereit" — nur neu zeichnen, wenn das
  // Import-Panel überhaupt an einem Chessable-Tab hängt.
  if (ciTabId != null) ciRender(lastCiState);
}

applyI18n(document);

if (chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['rcLang'], (r) => {
    rcLangStored = (r && r.rcLang) || '';
    rcLang = self.RepCheckI18n.resolveLang(rcLangStored, navigator.languages);
    repaintAll();
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.rcLang) {
      rcLangStored = ch.rcLang.newValue || '';
      rcLang = self.RepCheckI18n.resolveLang(rcLangStored, navigator.languages);
      repaintAll();
    }
  });
}

if (LANG_SELECT) {
  LANG_SELECT.addEventListener('change', () => {
    const v = LANG_SELECT.value;
    rcLangStored = v;
    rcLang = self.RepCheckI18n.resolveLang(v, navigator.languages);
    try {
      // Leerer Wert = „automatisch": Schlüssel löschen statt '' zu speichern, sonst würde
      // resolveLang zwar auch fallen, aber der Speicher trüge einen Wert ohne Bedeutung.
      if (v) chrome.storage.local.set({ rcLang: v });
      else chrome.storage.local.remove('rcLang');
    } catch (e) {}
    repaintAll();
  });
}

document.getElementById('open-chesscom').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.chess.com/' });
});
document.getElementById('open-lichess').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://lichess.org/' });
});

document.getElementById('run-check').addEventListener('click', () => triggerInTab('runCheck'));

// „Einstellungen" funktioniert auf allen drei Sites: auf chess.com/lichess öffnet es das
// In-Page-Konfigpanel (Repertoire-Prüfung); sonst — v. a. auf chessable.com — klappt es die
// Chessable-Button-Einstellungen direkt hier im Popup auf/zu (dort gibt es kein In-Page-Panel).
document.getElementById('open-settings').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (tab && tab.url && /^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab.url)) {
    triggerInTab('openSettings');
    return;
  }
  const box = document.getElementById('chessable-settings');
  box.style.display = (box.style.display === 'none' || !box.style.display) ? 'block' : 'none';
});

// ─── Chessable-Button-Einstellungen (pro Button ein-/ausblendbar) ──────
// Persistiert in chrome.storage.local `chessableButtons`; chessable-activity.js spiegelt es live
// an chessable-fen.js (MAIN-World), das die Buttons entsprechend zeigt/versteckt.
const CB_KEYS = ['copyFen', 'analyse', 'searchFen', 'refresh', 'remember', 'fullscreen'];
function cbEl(k) { return document.getElementById('cb-' + k); }
function loadChessableButtons() {
  if (!chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get('chessableButtons', (res) => {
    const s = (res && res.chessableButtons) || {};
    for (const k of CB_KEYS) { const el = cbEl(k); if (el) el.checked = s[k] !== false; }
  });
}
function saveChessableButtons() {
  const s = {};
  for (const k of CB_KEYS) { const el = cbEl(k); s[k] = el ? el.checked : true; }
  try { chrome.storage.local.set({ chessableButtons: s }); } catch (e) {}
}
for (const k of CB_KEYS) { const el = cbEl(k); if (el) el.addEventListener('change', saveChessableButtons); }
loadChessableButtons();

function readRookhubStore() {
  return new Promise((resolve) => {
    const req = indexedDB.open('RepertoireCheckerDB', 2);
    req.onerror = () => resolve({ config: null, cache: null });
    // Muss dem Schema in content.js openIDB() entsprechen — sonst legt das Popup
    // die DB ohne den rookhub-Store an und content.js bekommt keinen Upgrade-
    // Trigger mehr, weil die Version schon stimmt.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
      if (!db.objectStoreNames.contains('rookhub')) db.createObjectStore('rookhub');
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rookhub')) {
        db.close();
        resolve({ config: null, cache: null });
        return;
      }
      const tx = db.transaction('rookhub', 'readonly');
      const store = tx.objectStore('rookhub');
      const getCfg = store.get('config');
      const getCache = store.get('cache');
      let pending = 2;
      const out = { config: null, cache: null };
      const done = () => { if (--pending === 0) { db.close(); resolve(out); } };
      getCfg.onsuccess = () => { out.config = getCfg.result || null; done(); };
      getCfg.onerror = done;
      getCache.onsuccess = () => { out.cache = getCache.result || null; done(); };
      getCache.onerror = done;
    };
  });
}

// Holt die Repertoire-Liste vom RookHub-Server via Background-Worker (CORS-frei).
function fetchRookhubRepertoires(cfg) {
  const baseUrl = (cfg.url || '').replace(/\/$/, '');
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'rookhub-fetch',
      url: baseUrl + '/api/extension/repertoires?kind=opening',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/json',
      },
      expect: 'json',
    }, (resp) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!resp) { reject(new Error(t('err.noBackground'))); return; }
      if (resp.status === 401) { reject(new Error(t('err.tokenInvalid'))); return; }
      if (!resp.ok) { reject(new Error(resp.error || t('err.http', { status: resp.status }))); return; }
      resolve(Array.isArray(resp.body) ? resp.body : []);
    });
  });
}

// Zuletzt gezeigte Liste — für das Neubeschriften nach einem Sprachwechsel.
let repItems = null;

function renderRepertoireList(items) {
  repItems = (items && items.length) ? items : null;
  if (!items || items.length === 0) {
    REP_EL.style.display = 'none';
    return;
  }
  const heading = document.createElement('div');
  heading.className = 'heading';
  heading.textContent = t('popup.rep.heading', { count: items.length });
  const ul = document.createElement('ul');
  for (const it of items) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = it.name || t('popup.rep.unnamed');
    const count = document.createElement('span');
    count.className = 'count';
    if (typeof it.fileCount === 'number') {
      count.textContent = t('popup.rep.files', { count: it.fileCount });
    }
    li.appendChild(name);
    li.appendChild(count);
    ul.appendChild(li);
  }
  REP_EL.replaceChildren(heading, ul);
  REP_EL.style.display = 'block';
}

// Die RookHub-Config wird vom Content-Script auch nach chrome.storage.local
// gespiegelt (saveRookhubConfig, Key `rookhubConfig`). Das ist hier die
// VERLAESSLICHE Quelle: die IndexedDB `RepertoireCheckerDB` ist origin-scoped
// (chess.com/lichess) und im Popup-Origin (chrome-extension://…) NICHT lesbar —
// readRookhubStore() liefert hier also nie die Config. chrome.storage.local ist
// dagegen extension-weit.
function readRookhubConfigFromStorage() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) { resolve(null); return; }
    chrome.storage.local.get('rookhubConfig', (res) => {
      const c = res && res.rookhubConfig;
      resolve(c && c.url && c.token ? c : null);
    });
  });
}

// Statuszeile: Schlüssel + Parameter merken (nicht den fertigen Text), damit ein
// Sprachwechsel dieselbe Aussage ohne erneuten Netz-Roundtrip neu beschriften kann.
let statusPaint = { cls: 'status', key: 'popup.status.loading', params: null };
function setStatus(cls, key, params) {
  statusPaint = { cls, key, params: params || null };
  paintStatus();
}
function paintStatus() {
  STATUS_EL.className = statusPaint.cls;
  STATUS_EL.textContent = t(statusPaint.key, statusPaint.params);
}

async function refreshStatus() {
  let store;
  try {
    store = await readRookhubStore();
  } catch {
    store = { config: null, cache: null };
  }
  // chrome.storage.local-Spiegel hat Vorrang vor der (im Popup-Origin leeren) IDB.
  const config = (await readRookhubConfigFromStorage()) || store.config;
  const { cache } = store;

  if (config && config.url && config.token) {
    setStatus('status', 'popup.rookhub.loading');
    try {
      const items = await fetchRookhubRepertoires(config);
      if (items.length > 0) {
        setStatus('status loaded', 'popup.rookhub.connected', { count: items.length });
        renderRepertoireList(items);
      } else {
        setStatus('status empty', 'popup.rookhub.noOpenings');
      }
    } catch (e) {
      setStatus('status error', 'popup.rookhub.error', { error: e.message });
    }
    return;
  }

  if (cache && cache.count > 0) {
    const ago = Math.round((Date.now() - (cache.savedAt || 0)) / 60000);
    setStatus('status loaded', 'popup.local.loaded', { count: cache.count, min: ago });
    return;
  }

  setStatus('status empty', 'popup.none');
}

refreshStatus();

// ─── Chessable-Token ───────────────────────────────────────────────────
// Der von chessable.com abgefangene Bearer-Token liegt in chrome.storage.local
// (origin-uebergreifend lesbar). Das Popup zeigt ihn nicht an (zu lang), sondern
// bietet nur einen Copy-Button fuer die Weitergabe an piratechess.
const CHESSABLE_BOX = document.getElementById('chessable-box');
const COPY_CHESSABLE = document.getElementById('copy-chessable');
const CHESSABLE_STATE = document.getElementById('chessable-state');

let chessablePaint = null;
function setChessableState(key, params) {
  chessablePaint = { key, params: params || null };
  paintChessableState();
}
function paintChessableState() {
  if (chessablePaint) CHESSABLE_STATE.textContent = t(chessablePaint.key, chessablePaint.params);
}

function refreshChessableToken() {
  if (!chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get('chessableToken', (res) => {
    const entry = res && res.chessableToken;
    if (!entry || !entry.token) {
      CHESSABLE_BOX.style.display = 'none';
      return;
    }
    CHESSABLE_BOX.style.display = 'block';
    COPY_CHESSABLE.disabled = false;
    const ago = Math.round((Date.now() - (entry.capturedAt || 0)) / 60000);
    if (ago <= 0) setChessableState('popup.chessable.justCaptured');
    else setChessableState('popup.chessable.capturedAgo', { min: ago });
  });
}

COPY_CHESSABLE.addEventListener('click', () => {
  chrome.storage.local.get('chessableToken', async (res) => {
    const entry = res && res.chessableToken;
    if (!entry || !entry.token) return;
    try {
      await navigator.clipboard.writeText(entry.token);
      setChessableState('popup.copied');
    } catch (e) {
      setChessableState('popup.copyFailed');
    }
  });
});

refreshChessableToken();

function showError(msg) {
  ERROR_EL.textContent = msg;
  ERROR_EL.style.display = 'block';
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

// ─── Sharebar: Link zur aktuellen Line ─────────────────────────────────
// Oben im Popup ein oeffentlicher Nur-Ansehen-Link (/l/{token}) zur gerade auf
// chess.com/lichess gespielten Zugfolge. Beim Oeffnen des Popups wird die
// aktuelle Line aus dem Tab gelesen und serverseitig als Line geteilt (Dedup:
// dieselbe Zugfolge -> derselbe Link). Braucht eine konfigurierte RookHub-Instanz.
const SHAREBAR = document.getElementById('sharebar');
const SHARE_URL = document.getElementById('share-url');
const COPY_SHARE = document.getElementById('copy-share');
const SHARE_STATE = document.getElementById('share-state');

let sharePaint = null;
function setShareState(key, params) {
  sharePaint = { key, params: params || null };
  paintShareState();
}
function paintShareState() {
  if (sharePaint) SHARE_STATE.textContent = t(sharePaint.key, sharePaint.params);
}

async function ensureContentLoaded(tab) {
  const [precheck] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => !!window.__rdc_loaded,
  });
  if (!precheck || !precheck.result) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['chess.min.js', 'lib/repertoire-text.js', 'lib/i18n.js', 'content.js'],
    });
  }
}

async function getCurrentLineFromTab(tab) {
  await ensureContentLoaded(tab);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const api = window.__rdc_loaded;
      return api && typeof api.getCurrentLine === 'function' ? api.getCurrentLine() : { moves: [], title: '' };
    },
  });
  return (res && res.result) || { moves: [], title: '' };
}

function postShareLine(cfg, moves, title) {
  const baseUrl = (cfg.url || '').replace(/\/$/, '');
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'rookhub-fetch',
      url: baseUrl + '/api/extension/share-line',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ moves, title }),
      expect: 'json',
    }, (resp) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!resp) { reject(new Error(t('err.noBackground'))); return; }
      if (resp.status === 401) { reject(new Error(t('err.tokenInvalid'))); return; }
      if (!resp.ok) { reject(new Error(resp.error || t('err.http', { status: resp.status }))); return; }
      resolve(resp.body);
    });
  });
}

async function initShareBar() {
  const cfg = await readRookhubConfigFromStorage();
  if (!cfg) return; // ohne RookHub-Config kein Teilen-Link
  const tab = await getActiveTab();
  if (!tab || !tab.url || !/^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab.url)) return;
  SHAREBAR.style.display = 'block';
  setShareState('popup.share.loading');
  COPY_SHARE.disabled = true;
  try {
    const line = await getCurrentLineFromTab(tab);
    if (!line.moves || !line.moves.length) {
      SHARE_URL.value = '';
      setShareState('popup.share.noMoves');
      return;
    }
    const res = await postShareLine(cfg, line.moves, line.title);
    const token = res && (res.shareToken || res.ShareToken);
    if (!token) throw new Error(t('err.noToken'));
    SHARE_URL.value = (cfg.url || '').replace(/\/$/, '') + '/l/' + token;
    COPY_SHARE.disabled = false;
    setShareState('popup.share.ready', { count: line.moves.length });
  } catch (e) {
    SHARE_URL.value = '';
    setShareState('popup.share.failed', { error: (e && e.message ? e.message : String(e)) });
  }
}

COPY_SHARE.addEventListener('click', async () => {
  if (!SHARE_URL.value) return;
  try {
    await navigator.clipboard.writeText(SHARE_URL.value);
  } catch {
    SHARE_URL.select();
    document.execCommand('copy');
  }
  setShareState('popup.copied');
});

initShareBar();

// ─── RookHub-Import (Browser) auf chessable.com ────────────────────────
// Das früher on-page (links unten) eingeblendete Import-Panel lebt jetzt hier im Popup.
// Das Content-Script chessable-activity.js (isolierte Welt, per manifest auto-injiziert)
// hält den Zustand + die Import-Logik; das Popup fragt ihn per chrome.tabs.sendMessage ab
// (`{type:'rc-import', action}`) und pollt `state`, solange es offen ist.
const CI_BOX = document.getElementById('chessable-import');
const CI_COURSE = document.getElementById('ci-course');
const CI_CRAWL = document.getElementById('ci-crawl');
const CI_IMPORTCAP = document.getElementById('ci-importcap');
const CI_LIVE = document.getElementById('ci-live');
const CI_PROGRESS = document.getElementById('ci-progress');
const CI_STATUS = document.getElementById('ci-status');
let ciTabId = null, ciPoll = null, ciTargetInit = false;
// Mitlaufender Timer im Status („… · 1:23"): Basistext + Crawl-Startzeit getrennt halten,
// damit ein 1-s-Ticker die verstrichene Zeit unabhängig vom 1,5-s-State-Poll aktualisiert.
let ciStatusBase = '', ciStartedAt = null, ciTimerInt = null;
let ciCrawling = false;
// Letzter vom Content-Script gemeldeter Zustand — für das Neuzeichnen nach Sprachwechsel.
let lastCiState = null;

function ciElapsedLabel(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function paintCiStatus() {
  CI_STATUS.textContent = ciStartedAt
    ? (ciStatusBase ? `${ciStatusBase} · ${ciElapsedLabel(ciStartedAt)}` : ciElapsedLabel(ciStartedAt))
    : ciStatusBase;
}

function ciSelectedTarget() {
  const r = document.querySelector('input[name="ci-target"]:checked');
  return r ? r.value : 'repertoire';
}

function ciSend(action, extra) {
  return new Promise((resolve) => {
    if (ciTabId == null) { resolve(null); return; }
    chrome.tabs.sendMessage(ciTabId, Object.assign({ type: 'rc-import', action }, extra || {}), (resp) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(resp || null);
    });
  });
}

function ciRender(st) {
  lastCiState = st;
  if (!st) {
    CI_COURSE.textContent = t('import.notReady');
    CI_CRAWL.disabled = true;
    return;
  }
  CI_COURSE.textContent = st.onCourse
    ? (st.courseName ? t('import.course', { name: st.courseName }) : t('import.courseId', { id: st.bid }))
    : t('import.openCourse');
  ciCrawling = !!st.crawling;
  if (ciCrawling) {
    // „Kurs holen"-Button wird während des Laufs zum Abbrechen-Knopf.
    CI_CRAWL.textContent = t('import.cancel');
    CI_CRAWL.classList.add('ci-cancel');
    CI_CRAWL.disabled = false;
  } else {
    CI_CRAWL.textContent = t('import.crawl');
    CI_CRAWL.classList.remove('ci-cancel');
    CI_CRAWL.disabled = !st.onCourse;
  }
  // Ziel-Radios einmalig aus dem Zustand vorbelegen, danach nicht gegen den User kämpfen.
  if (!ciTargetInit && (st.target === 'book' || st.target === 'repertoire')) {
    const r = document.querySelector(`input[name="ci-target"][value="${st.target}"]`);
    if (r) r.checked = true;
    ciTargetInit = true;
  }
  if (st.captured > 0) {
    CI_IMPORTCAP.style.display = 'block';
    CI_IMPORTCAP.textContent = t('import.captured', { count: st.captured });
  } else {
    CI_IMPORTCAP.style.display = 'none';
  }
  if (document.activeElement !== CI_LIVE) CI_LIVE.checked = !!st.autoImport;
  if (st.progress) {
    const p = st.progress;
    const b = document.createElement('b');
    b.textContent = t('import.onRookhub', { done: p.done, total: p.total, pct: p.pct });
    CI_PROGRESS.replaceChildren(b);
  } else {
    CI_PROGRESS.textContent = '';
  }
  ciStatusBase = st.status || '';
  ciStartedAt = (st.crawling && st.crawlStartedAt) ? st.crawlStartedAt : null;
  paintCiStatus();
  if (ciStartedAt && !ciTimerInt) ciTimerInt = setInterval(paintCiStatus, 1000);
  if (!ciStartedAt && ciTimerInt) { clearInterval(ciTimerInt); ciTimerInt = null; }
}

async function ciTick() { ciRender(await ciSend('state')); }

async function initChessableImport() {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !/^https:\/\/(www\.)?chessable\.com\//.test(tab.url)) return;
  ciTabId = tab.id;
  CI_BOX.style.display = 'block';

  // Falls das Content-Script (noch) nicht antwortet (Tab vor dem Extension-Update geladen),
  // einmal nachinjizieren (Guard in chessable-activity.js verhindert Doppel-Init).
  let st = await ciSend('state');
  if (!st) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/chessable-crawl.js', 'lib/chessable-course-names.js', 'chessable-activity.js'] });
    } catch (e) { /* ignore */ }
    st = await ciSend('state');
  }
  ciRender(st);

  CI_CRAWL.addEventListener('click', async () => {
    // Läuft ein Crawl, ist derselbe Button der Abbrechen-Knopf.
    if (ciCrawling) {
      await ciSend('cancel');
      ciTick();
      return;
    }
    // Bannrisiko: der aktive Crawl klappert die Chessable-API automatisiert ab → explizite Bestätigung.
    const ok = window.confirm(
      t('import.warn.title') + '\n\n' +
      t('import.warn.body') + '\n\n' +
      t('import.warn.own') + '\n\n' +
      t('import.warn.confirm')
    );
    if (!ok) return;
    CI_STATUS.textContent = t('import.starting');
    await ciSend('crawl', { target: ciSelectedTarget() });
    ciTick();
  });
  CI_IMPORTCAP.addEventListener('click', async () => {
    CI_STATUS.textContent = t('import.importing');
    await ciSend('importCaptured', { target: ciSelectedTarget() });
    ciTick();
  });
  CI_LIVE.addEventListener('change', () => ciSend('setLive', { enabled: CI_LIVE.checked }));
  document.querySelectorAll('input[name="ci-target"]').forEach((r) =>
    r.addEventListener('change', () => ciSend('setTarget', { target: ciSelectedTarget() })));

  ciPoll = setInterval(ciTick, 1500);
  window.addEventListener('unload', () => { if (ciPoll) clearInterval(ciPoll); if (ciTimerInt) clearInterval(ciTimerInt); });
}

initChessableImport();

// Triggert die angegebene Aktion im Content-Script. Laedt chess.min.js +
// content.js nur dann, wenn der Tab sie noch nicht hat (Idempotency-Guard
// in content.js).
async function triggerInTab(action) {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !/^https:\/\/(www\.chess\.com|lichess\.org)\//.test(tab.url)) {
    showError(t('popup.needTab'));
    return;
  }
  try {
    // 1) Pruefen, ob content.js schon geladen ist.
    const [precheck] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!window.__rdc_loaded,
    });
    if (!precheck || !precheck.result) {
      // 2) Lazy-Inject chess.min.js + Shared-Core (RepCheckLib) + content.js (einmalig pro Tab).
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['chess.min.js', 'lib/repertoire-text.js', 'lib/i18n.js', 'content.js'],
      });
    }
    // 3) Aktion ausloesen.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [action],
      func: (act) => {
        const api = window.__rdc_loaded;
        if (!api || typeof api[act] !== 'function') {
          console.warn('[RepertoireChecker] Kein Eintrag fuer Aktion:', act);
          return;
        }
        api[act]();
      },
    });
    window.close();
  } catch (e) {
    showError(t('popup.error', { error: (e && e.message ? e.message : String(e)) }));
  }
}
