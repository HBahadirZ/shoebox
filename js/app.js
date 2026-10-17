import { CONFIG } from './config.js';
import { allItems, putItem, deleteItem, clearItems, getMeta, setMeta, uid, blobToDataURL, dataURLToBlob } from './db.js';
import { coverage, needsAttention, urgency, formatDate, humanizeDays, todayISO } from './dates.js';
import { parseReceipt } from './parse.js';
import { prepare, readReceipt, warmUp } from './ocr.js';
import { toCSV, toICS, download } from './export.js';
import { initPro, buyPro, restorePro, isPro, proState, onProChange, storeLink } from './pro.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CURRENCIES = { USD: 'US dollar', CAD: 'Canadian dollar', EUR: 'Euro', GBP: 'British pound', AUD: 'Australian dollar', NZD: 'New Zealand dollar', TRY: 'Turkish lira', INR: 'Indian rupee', MXN: 'Mexican peso', JPY: 'Japanese yen' };
const lang = navigator.language || 'en-US';

const S = {
  items: [], view: 'attention', filter: 'all', query: '',
  settings: { currency: /-CA$/i.test(lang) ? 'CAD' : /-GB$/i.test(lang) ? 'GBP' : 'USD', dayFirst: !/^en-(US|CA)$/i.test(lang) && !/^en$/i.test(lang), warrantyMonths: 12, returnDays: 30 },
  editing: null, queue: [], pending: null, thumbs: new Map(),
};
const today = () => todayISO();
const money = (v, cur) => { try { return new Intl.NumberFormat(lang, { style: 'currency', currency: cur || S.settings.currency }).format(v); } catch { return `${v} ${cur}`; } };
const cov = (it) => coverage(it, today());

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); }
const thumbURL = (it) => {
  if (!it.photo) return '';
  if (!S.thumbs.has(it.id)) S.thumbs.set(it.id, URL.createObjectURL(it.photo));
  return S.thumbs.get(it.id);
};
const thumb = (it) => it.photo ? `<img class="thumb" src="${thumbURL(it)}" alt="" loading="lazy">` : `<span class="thumb"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:26px;height:26px"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6"/></svg></span>`;

/* ---------- rendering ---------- */
function pills(c) {
  const p = [];
  if (c.warranty === 'lifetime') p.push(['Lifetime warranty', '']);
  else if (c.warranty === 'active') p.push([`Warranty until ${formatDate(c.warrantyEnd, lang)}`, '']);
  else if (c.warranty === 'soon') p.push([`Warranty ends ${humanizeDays(c.warrantyDays)}`, 'soon']);
  else if (c.warranty === 'expired') p.push(['Warranty ended', 'muted']);
  if (c.return === 'open') p.push([`Return by ${formatDate(c.returnEnd, lang)}`, '']);
  else if (c.return === 'closing') p.push([`Return window closes ${humanizeDays(c.returnDays)}`, 'urgent']);
  return p.map(([t, k]) => `<span class="pill ${k}">${esc(t)}</span>`).join('');
}
const attention = () => S.items.map((it) => ({ it, c: cov(it) })).filter(({ c }) => needsAttention(c)).sort((a, b) => urgency(a.c) - urgency(b.c));

function render() {
  document.body.dataset.view = S.view;
  const att = attention();
  const badge = $('#attnCount'); badge.hidden = !att.length; badge.textContent = att.length;
  if (navigator.setAppBadge) { try { att.length ? navigator.setAppBadge(att.length) : navigator.clearAppBadge(); } catch { /* unsupported */ } }
  const main = $('#main');
  const html = S.view === 'attention' ? viewAttention(att) : viewAll();
  const apply = () => { main.innerHTML = html; };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply); else apply();
}

function viewAttention(att) {
  const covered = S.items.filter((it) => ['active', 'soon', 'lifetime'].includes(cov(it).warranty)).length;
  const hello = S.items.length
    ? (att.length ? `${att.length} thing${att.length === 1 ? '' : 's'} need${att.length === 1 ? 's' : ''} you soon` : 'Nothing is about to expire')
    : 'Your receipts, in one box';
  const sub = S.items.length ? 'Warranties ending within 60 days and return windows closing within 7 days.' : 'Add a receipt and Shoebox will track the warranty and return deadline for you.';
  let out = `<section class="hero"><div><h1>${esc(hello)}</h1><p>${esc(sub)}</p></div></section>`;
  if (!S.items.length) {
    return out + `<div class="empty"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6h24v36l-4-3-4 3-4-3-4 3-4-3-4 3z"/><path d="M18 16h12M18 23h12M18 30h7"/></svg>
      <h2>Snap your first receipt</h2><p>Drop a photo, paste a screenshot, or use the camera. The reading happens on this PC, offline.</p>
      <button class="btn primary" data-action="add">Add receipt</button></div>`;
  }
  out += `<div class="stats"><div class="stat"><b>${S.items.length}</b><span>receipts saved</span></div><div class="stat"><b>${covered}</b><span>still under warranty</span></div><div class="stat ${att.length ? 'warn' : ''}"><b>${att.length}</b><span>need attention</span></div></div>`;
  if (att.length) out += `<div class="cards">${att.map(({ it, c }) => card(it, c)).join('')}</div>`;
  else out += `<div class="empty"><h2>All clear</h2><p>Shoebox will flag anything that is about to run out.</p></div>`;
  return out;
}
const card = (it, c) => `<button class="card" data-action="open" data-id="${esc(it.id)}">${thumb(it)}<div><h3>${esc(it.name)}</h3><div class="sub">${esc(it.store)}${it.store ? ' · ' : ''}${esc(formatDate(it.date, lang))}</div><div class="pills">${pills(c)}</div></div></button>`;

const FILTERS = [['all', 'All'], ['covered', 'Under warranty'], ['soon', 'Ending soon'], ['expired', 'Expired']];
function filtered() {
  const q = S.query.trim().toLowerCase();
  return S.items.map((it) => ({ it, c: cov(it) })).filter(({ it, c }) => {
    if (q && !`${it.name} ${it.store} ${it.category} ${it.notes}`.toLowerCase().includes(q)) return false;
    if (S.filter === 'covered') return ['active', 'soon', 'lifetime'].includes(c.warranty);
    if (S.filter === 'soon') return needsAttention(c);
    if (S.filter === 'expired') return c.warranty === 'expired';
    return true;
  }).sort((a, b) => (b.it.date > a.it.date ? 1 : -1));
}
function viewAll() {
  const rows = filtered();
  return `<section class="hero"><div><h1>All receipts</h1><p>${S.items.length} saved on this PC.</p></div></section>
  <div class="toolbar"><label class="search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg><span class="sr-only">Search receipts</span><input id="search" type="search" placeholder="Search by item, store or note" value="${esc(S.query)}"></label>
  <div class="chips">${FILTERS.map(([k, l]) => `<button class="chip" data-action="filter" data-filter="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('')}</div></div>
  ${rows.length ? `<div class="list">${rows.map(({ it, c }) => `<button class="row-item" data-action="open" data-id="${esc(it.id)}">${thumb(it)}<div><div class="name">${esc(it.name)}</div><div class="sub">${esc(it.store)}${it.store ? ' · ' : ''}${esc(formatDate(it.date, lang))}</div><div class="pills">${pills(c)}</div></div><div class="price">${it.price != null ? esc(money(it.price, it.currency)) : ''}</div></button>`).join('')}</div>`
    : `<div class="empty"><h2>${S.items.length ? 'No matches' : 'No receipts yet'}</h2><p>${S.items.length ? 'Try a different search or filter.' : 'Add your first receipt to get started.'}</p></div>`}`;
}

/* ---------- dialogs ---------- */
const dlg = (id) => $('#' + id);
const openDlg = (id) => { const d = dlg(id); if (!d.open) d.showModal(); };
const closeDlg = (id) => { const d = dlg(id); if (d.open) d.close(); };
for (const [id, list] of [['f-currency', CURRENCIES], ['set-currency', CURRENCIES]]) $('#' + id).innerHTML = Object.entries(list).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

function proGate(reason) {
  if (isPro()) return true;
  const r = $('#proReason'); r.hidden = !reason; r.textContent = reason || '';
  refreshProDialog(); openDlg('proDialog'); return false;
}
function refreshProDialog() {
  const st = proState(), owned = isPro();
  $('#proPrice').textContent = st.price;
  $('#proOwned').hidden = !owned;
  $('#buyPro').hidden = owned || !st.available;
  $('#restorePro').hidden = owned || !st.available;
  $('#proStoreNote').hidden = owned || st.available;
  $('#proStoreLink').href = storeLink();
  $('#proBadge').hidden = !owned; $('#getPro').hidden = owned;
}

function setGuess(el, on) { el.classList.toggle('guess', on); el.closest('.field')?.classList.toggle('guess', on); }
function updateCover() {
  const date = $('#f-date').value;
  const rec = { date, warrantyMonths: +$('#f-warranty').value, returnDays: +$('#f-return').value };
  const c = coverage(rec, today());
  const bits = [];
  if (c.warranty === 'lifetime') bits.push('Lifetime warranty.');
  if (c.warrantyEnd) bits.push(c.warranty === 'expired' ? `Warranty ended ${formatDate(c.warrantyEnd, lang)}.` : `Warranty runs to ${formatDate(c.warrantyEnd, lang)} (${humanizeDays(c.warrantyDays)}).`);
  if (c.returnEnd) bits.push(c.return === 'closed' ? `Return window closed ${formatDate(c.returnEnd, lang)}.` : `Return by ${formatDate(c.returnEnd, lang)} (${humanizeDays(c.returnDays)}).`);
  $('#itemCover').textContent = bits.join(' ') || 'No warranty or return window set.';
}

function openEditor({ item, draft, photo, hint }) {
  const it = item || { id: uid(), name: '', store: '', date: today(), price: null, currency: S.settings.currency, category: '', warrantyMonths: S.settings.warrantyMonths, returnDays: S.settings.returnDays, notes: '', ...draft };
  S.editing = { item: it, isNew: !item, photo: photo || it.photo || null };
  $('#itemTitle').textContent = item ? 'Receipt details' : 'Check the details';
  const h = $('#itemHint'); h.hidden = !hint; h.textContent = hint || '';
  $('#f-name').value = it.name; $('#f-store').value = it.store; $('#f-date').value = it.date;
  $('#f-price').value = it.price ?? ''; $('#f-currency').value = CURRENCIES[it.currency] ? it.currency : S.settings.currency;
  $('#f-warranty').value = String(it.warrantyMonths); $('#f-return').value = String(it.returnDays);
  $('#f-category').value = it.category || ''; $('#f-notes').value = it.notes || '';
  for (const k of ['store', 'date', 'price', 'currency']) setGuess($('#f-' + k), !!(draft && draft._guessed?.includes(k)));
  const fig = $('#itemPhoto');
  fig.innerHTML = S.editing.photo ? `<img src="${URL.createObjectURL(S.editing.photo)}" alt="Receipt photo" data-action="big-photo"><figcaption>Click to enlarge</figcaption>` : '<figcaption>No photo</figcaption>';
  $('#delBtn').hidden = !item;
  $('#saveBtn').textContent = S.queue.length ? 'Save and next' : 'Save receipt';
  updateCover(); openDlg('itemDialog');
  setTimeout(() => (it.name ? $('#f-store') : $('#f-name')).focus(), 50);
}

async function saveEditor(e) {
  e.preventDefault();
  const { item, isNew, photo } = S.editing;
  const price = parseFloat(String($('#f-price').value).replace(',', '.'));
  const rec = { ...item, name: $('#f-name').value.trim(), store: $('#f-store').value.trim(), date: $('#f-date').value, price: Number.isFinite(price) ? price : null,
    currency: $('#f-currency').value, category: $('#f-category').value, warrantyMonths: +$('#f-warranty').value, returnDays: +$('#f-return').value, notes: $('#f-notes').value.trim(), photo: photo || null,
    createdAt: item.createdAt || Date.now() };
  if (!rec.name || !rec.date) return;
  if (isNew && S.items.length >= CONFIG.freeLimit && !proGate(`The free version holds ${CONFIG.freeLimit} receipts.`)) return;
  await putItem(rec);
  const i = S.items.findIndex((x) => x.id === rec.id);
  if (i >= 0) S.items[i] = rec; else S.items.push(rec);
  S.thumbs.delete(rec.id);
  closeDlg('itemDialog'); S.editing = null; render(); toast(isNew ? 'Saved to your Shoebox' : 'Changes saved');
  afterEditor();
}
function afterEditor() { S.pending = null; if (S.queue.length) processNext(); }

/* ---------- adding receipts ---------- */
async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) { toast('Please choose a photo (JPG, PNG or WebP).'); return; }
  if (S.items.length >= CONFIG.freeLimit && !proGate(`The free version holds ${CONFIG.freeLimit} receipts.`)) return;
  closeDlg('addDialog'); stopCamera();
  S.queue.push(...imgs);
  if (!S.pending) processNext();
}
async function processNext() {
  const file = S.queue.shift();
  if (!file) { S.pending = null; return; }
  S.pending = file;
  const bar = $('#scanBar'), barBox = bar.parentElement;
  bar.style.width = '0'; barBox.classList.add('indet'); $('#scanNote').textContent = 'Starting the on-device reader…';
  $('#scanTitle').textContent = S.queue.length ? `Reading receipt (${S.queue.length} more waiting)` : 'Reading receipt…';
  openDlg('scanDialog');
  let draft = {}, photo = null, hint = '';
  try {
    const prep = await prepare(file); photo = prep.photo;
    $('#scanNote').textContent = 'Reading the text. This stays on your PC.';
    const text = await readReceipt(prep.ocr, (p) => { barBox.classList.remove('indet'); bar.style.width = Math.round(p * 100) + '%'; });
    const r = parseReceipt(text, { dayFirst: S.settings.dayFirst });
    const g = [];
    if (r.store) { draft.store = r.store; g.push('store'); }
    if (r.date) { draft.date = r.date; g.push('date'); }
    if (r.price != null) { draft.price = r.price; g.push('price'); }
    if (r.currency && CURRENCIES[r.currency]) { draft.currency = r.currency; g.push('currency'); }
    draft._guessed = g;
    hint = g.length ? 'Highlighted fields were read from the receipt. Please check them, then name the item.' : 'Could not read much from this photo. Fill in the details below.';
  } catch (err) {
    console.warn(err);
    hint = 'The reader could not start, so please fill in the details by hand.';
    try { photo = photo || file; } catch { /* ignore */ }
  }
  closeDlg('scanDialog');
  openEditor({ draft, photo, hint });
}

let stream;
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
    const v = $('#camVideo'); v.srcObject = stream; await v.play();
    $('#cameraBox').hidden = false; $('#dropzone').hidden = true;
  } catch { toast('Could not open a camera. Choose a photo instead.'); }
}
function stopCamera() { stream?.getTracks().forEach((t) => t.stop()); stream = null; $('#cameraBox').hidden = true; $('#dropzone').hidden = false; }
async function snap() {
  const v = $('#camVideo'), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  addFiles([new File([blob], 'camera.jpg', { type: 'image/jpeg' })]);
}

/* ---------- confirm, backup, export ---------- */
function confirmBox(text, yesLabel = 'Delete') {
  $('#confirmText').textContent = text; dlg('confirmDialog').querySelector('[data-action="confirm-yes"]').textContent = yesLabel; openDlg('confirmDialog');
  return new Promise((res) => { confirmBox.res = res; });
}
async function backup() {
  const items = await Promise.all(S.items.map(async (it) => ({ ...it, photo: it.photo ? await blobToDataURL(it.photo) : null })));
  download(`shoebox-backup-${today()}.json`, 'application/json', JSON.stringify({ app: 'shoebox', version: 1, settings: S.settings, items }));
  toast('Backup saved to your Downloads folder');
}
async function restore(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'shoebox' || !Array.isArray(data.items)) throw new Error('bad');
    let n = 0;
    for (const raw of data.items) {
      if (!raw.id || !raw.name) continue;
      const rec = { ...raw, photo: raw.photo ? await dataURLToBlob(raw.photo) : null };
      await putItem(rec); n++;
    }
    S.items = await allItems(); render(); toast(`Restored ${n} receipt${n === 1 ? '' : 's'}`);
  } catch { toast('That file is not a Shoebox backup.'); }
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'view': S.view = el.dataset.view; render(); break;
    case 'add': openDlg('addDialog'); break;
    case 'pick': $('#filePick').click(); break;
    case 'camera': startCamera(); break;
    case 'snap': snap(); break;
    case 'stop-camera': stopCamera(); break;
    case 'manual': closeDlg('addDialog'); if (S.items.length >= CONFIG.freeLimit && !proGate(`The free version holds ${CONFIG.freeLimit} receipts.`)) break; openEditor({ hint: '' }); break;
    case 'filter': S.filter = el.dataset.filter; render(); break;
    case 'open': { const it = S.items.find((x) => x.id === id); if (it) openEditor({ item: it }); break; }
    case 'big-photo': $('#bigPhoto').src = el.src; openDlg('photoDialog'); break;
    case 'cancel-item': closeDlg('itemDialog'); S.editing = null; afterEditor(); break;
    case 'delete-item': {
      if (await confirmBox(`Delete “${S.editing.item.name}” and its photo? This cannot be undone.`)) {
        const rid = S.editing.item.id; await deleteItem(rid); S.items = S.items.filter((x) => x.id !== rid); closeDlg('itemDialog'); S.editing = null; render(); toast('Deleted');
      } break; }
    case 'confirm-yes': closeDlg('confirmDialog'); confirmBox.res?.(true); break;
    case 'confirm-no': closeDlg('confirmDialog'); confirmBox.res?.(false); break;
    case 'close-dialog': el.closest('dialog').close(); if (el.closest('#addDialog')) stopCamera(); break;
    case 'open-settings': syncSettings(); openDlg('settingsDialog'); break;
    case 'open-pro': proGate(''); break;
    case 'buy-pro': try { if (await buyPro()) { toast('Thank you! Pro is unlocked.'); } } catch { toast('Purchase was cancelled.'); } refreshProDialog(); break;
    case 'restore-pro': try { toast((await restorePro()) ? 'Pro restored' : 'No Pro purchase found on this account'); } catch { toast('Could not reach the Store.'); } refreshProDialog(); break;
    case 'backup': backup(); break;
    case 'restore': $('#restorePick').click(); break;
    case 'export-csv': if (proGate('CSV export is part of Pro.')) { download(`shoebox-${today()}.csv`, 'text/csv;charset=utf-8', toCSV(S.items, today())); toast('CSV saved to Downloads'); } break;
    case 'export-ics': if (proGate('Calendar reminders are part of Pro.')) { download('shoebox-reminders.ics', 'text/calendar;charset=utf-8', toICS(S.items, today())); toast('Open the .ics file to add the reminders to your calendar'); } break;
    case 'wipe': if (await confirmBox(`Delete all ${S.items.length} receipts from this PC? Save a backup first if unsure.`, 'Delete all')) { await clearItems(); S.items = []; S.thumbs.clear(); closeDlg('settingsDialog'); render(); toast('Everything deleted'); } break;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { S.query = e.target.value; const pos = e.target.selectionStart; render(); setTimeout(() => { const s = $('#search'); s?.focus(); s?.setSelectionRange(pos, pos); }, 30); }
  if (e.target.closest('#itemForm')) { updateCover(); if (e.target.id?.startsWith('f-')) setGuess(e.target, false); }
});
document.addEventListener('change', (e) => { if (e.target.closest('#itemForm')) updateCover(); });
$('#itemForm').addEventListener('submit', saveEditor);
$('#filePick').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#restorePick').addEventListener('change', (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });
$('#itemDialog').addEventListener('cancel', () => { S.editing = null; afterEditor(); });
$('#addDialog').addEventListener('close', stopCamera);

// drag & drop and paste
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
addEventListener('paste', (e) => { if (/input|textarea/i.test(e.target.tagName)) return; const f = [...(e.clipboardData?.files || [])]; if (f.length) addFiles(f); });
addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !document.querySelector('dialog[open]')) { e.preventDefault(); openDlg('addDialog'); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

/* ---------- settings ---------- */
function syncSettings() {
  $('#set-currency').value = S.settings.currency; $('#set-dayFirst').value = S.settings.dayFirst ? '1' : '0';
  $('#set-warranty').value = String(S.settings.warrantyMonths); $('#set-return').value = String(S.settings.returnDays);
}
$('#settingsDialog').addEventListener('change', async () => {
  S.settings = { currency: $('#set-currency').value, dayFirst: $('#set-dayFirst').value === '1', warrantyMonths: +$('#set-warranty').value, returnDays: +$('#set-return').value };
  await setMeta('settings', S.settings);
});
$('#supportLink').href = `mailto:${CONFIG.supportEmail}?subject=Shoebox%20support`;

/* ---------- launch paths: file handler, share target, shortcuts ---------- */
if ('launchQueue' in window) {
  launchQueue.setConsumer(async (params) => {
    const files = []; for (const h of params.files || []) files.push(await h.getFile());
    if (files.length) addFiles(files);
  });
}
async function takeShared() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('shoebox-share'); const files = [];
    for (const req of await cache.keys()) { const res = await cache.match(req); const blob = await res.blob(); files.push(new File([blob], req.url.split('/').pop(), { type: blob.type })); await cache.delete(req); }
    if (files.length) addFiles(files);
  } catch { /* nothing shared */ }
}

/* ---------- boot ---------- */
async function boot() {
  try { Object.assign(S.settings, (await getMeta('settings')) || {}); } catch { /* first run */ }
  try { S.items = await allItems(); } catch { toast('Storage is unavailable, so receipts cannot be saved.'); }
  const sp = new URLSearchParams(location.search);
  if (sp.get('view') === 'all') S.view = 'all';
  render();
  if (!('showModal' in HTMLDialogElement.prototype)) toast('Please update your browser to use Shoebox.');
  $('#cameraBtn').hidden = !navigator.mediaDevices?.getUserMedia;
  onProChange(refreshProDialog);
  initPro().then(refreshProDialog);
  refreshProDialog();
  if (sp.get('action') === 'add') openDlg('addDialog');
  takeShared();
  warmUp();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__shoebox = S; // handy for automated tests
}
boot();
