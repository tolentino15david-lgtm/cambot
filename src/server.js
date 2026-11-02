const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, '..', 'data', 'inventory.json');
const ADMIN_DATA = path.join(__dirname, '..', 'data', 'admin-data.json');
const ACTIVITY_DATA = path.join(__dirname, '..', 'data', 'activity-log.json');
const LEADS_DATA = path.join(__dirname, '..', 'data', 'customer-interests.json');
const ADMIN_PASSWORD = process.env.CAMBOT_ADMIN_PASSWORD || 'ChangeMe-CAMBOT-2026!';
const adminSessions = new Map();
const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1tVpoGlXjLyYi0z1_sFGhK-NetODBihGKbalQI_2szeg';
const SHEET_GID = process.env.GOOGLE_SHEET_GID || '';
const SHEET_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL || `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv${SHEET_GID ? `&gid=${encodeURIComponent(SHEET_GID)}` : ''}`;
const SYNC_INTERVAL_MS = Math.max(30000, Number(process.env.SHEET_SYNC_INTERVAL_MS || 60000));
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const GOOGLE_SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Sheet1';
const PUBLIC_INSTAGRAM_URL = process.env.CAMBOT_INSTAGRAM_URL || '';
const PUBLIC_MESSENGER_URL = process.env.CAMBOT_MESSENGER_URL || '';
const PUBLIC_WHATSAPP_URL = process.env.CAMBOT_WHATSAPP_URL || '';
const ACTIVITY_LIMIT = 500;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

let cachedSheetItems = null;
let sheetState = { source: 'local', status: 'starting', lastSync: null, lastError: null, count: 0 };
let refreshInFlight = null;

function readLocalInventory() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function writeInventory(items) { fs.writeFileSync(DATA, JSON.stringify(items, null, 2)); }
function readAdminData() {
  try { return JSON.parse(fs.readFileSync(ADMIN_DATA, 'utf8')); }
  catch { return { additions: [], overrides: {}, hiddenIds: [] }; }
}
function writeAdminData(data) { fs.writeFileSync(ADMIN_DATA, JSON.stringify(data, null, 2)); }
function readArrayFile(file) { try { const x = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(x) ? x : []; } catch { return []; } }
function writeArrayFile(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function logActivity(action, details = {}) { const rows = readArrayFile(ACTIVITY_DATA); rows.unshift({ id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), action, ...details }); writeArrayFile(ACTIVITY_DATA, rows.slice(0, ACTIVITY_LIMIT)); }
function duplicateMatches(brand, model, excludeId = '') { const key = normalize(`${brand} ${model}`); if (!key) return []; return currentInventory().filter(x => String(x.id) !== String(excludeId) && normalize(`${x.brand} ${x.model}`) === key).slice(0, 5).map(x => ({ id: x.id, brand: x.brand, model: x.model, price: x.price, status: x.status })); }
function safeContactUrl(raw) { try { const u = new URL(String(raw || '')); return ['https:', 'http:'].includes(u.protocol) ? u.toString() : ''; } catch { return ''; } }
function b64url(input) { return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
async function googleAccessToken() {
  if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('Google Sheets write-back is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on the server.');
  let account; try { account = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.'); }
  if (!account.client_email || !account.private_key) throw new Error('Service account JSON must include client_email and private_key.');
  const now = Math.floor(Date.now() / 1000), header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: account.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3500 }));
  const unsigned = `${header}.${claim}`, signer = crypto.createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const jwt = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch(account.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); if (!response.ok || !data.access_token) throw new Error(`Google authentication failed: ${data.error_description || data.error || response.status}`); return data.access_token;
}
function colLetter(index) { let n = index + 1, out = ''; while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; }
function quoteTab(tab) { return `'${String(tab).replace(/'/g, "''")}'`; }
function sheetColumnMap(headers) { return { model: findColumn(headers, ['camera model','camera','model','camera name','product name']), brand: findColumn(headers, ['brand','camera brand','manufacturer']), price: findColumn(headers, ['presyo','price','selling price','amount','price php']), issues: findColumn(headers, ['issues kondisyon','issues condition','issues','known issues','condition notes','issue']), condition: findColumn(headers, ['condition','condition status','physical condition']), inclusions: findColumn(headers, ['inclusions','included items','inclusions accessories','accessories']), status: findColumn(headers, ['status','listing status','availability']), link: findColumn(headers, ['link','seller link','original link','listing link','instagram link','source link']), image: findColumn(headers, ['photo url','photo','image url','image','camera photo','picture url','image link']), notes: findColumn(headers, ['notes','remarks','additional notes']) }; }
async function googleSheetsRequest(endpoint, options = {}) { const token = await googleAccessToken(); const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error?.message || `Google Sheets API returned HTTP ${response.status}`); return data; }
async function getWriteHeaders() { const data = await googleSheetsRequest(`/values/${encodeURIComponent(`${quoteTab(GOOGLE_SHEET_TAB)}!1:1`)}`); const headers = data.values?.[0] || []; if (!headers.length) throw new Error(`No headers found in tab "${GOOGLE_SHEET_TAB}".`); return headers; }
function valuesForItem(item, headers, existing = []) { const map = sheetColumnMap(headers), values = [...existing]; while (values.length < headers.length) values.push(''); const set = (i, v) => { if (i >= 0) values[i] = v; }; set(map.model,item.model); set(map.brand,item.brand); set(map.price,item.price); set(map.issues,item.issues); set(map.condition,item.condition); set(map.inclusions,Array.isArray(item.inclusions)?item.inclusions.join(', '):item.inclusions); set(map.status,({available:'Available',sold:'Sold',unavailable:'Unavailable',needs_review:'Needs Review'})[item.status]||item.status); set(map.link,item.sellerUrl||item.instagramUrl); set(map.image,item.imageUrl); set(map.notes,item.notes); return values; }
async function writeItemToGoogleSheet(item, rowNumber = null) { const headers = await getWriteHeaders(), tab = quoteTab(GOOGLE_SHEET_TAB); if (rowNumber) { const current = await googleSheetsRequest(`/values/${encodeURIComponent(`${quoteTab(GOOGLE_SHEET_TAB)}!A${rowNumber}:ZZ${rowNumber}`)}`); const row = valuesForItem(item, headers, current.values?.[0]||[]), end = colLetter(Math.max(headers.length-1,0)); await googleSheetsRequest(`/values/${encodeURIComponent(`${tab}!A${rowNumber}:${end}${rowNumber}`)}?valueInputOption=USER_ENTERED`, { method:'PUT', body:JSON.stringify({range:`${tab}!A${rowNumber}:${end}${rowNumber}`,majorDimension:'ROWS',values:[row]}) }); return {action:'updated',row:rowNumber}; } const row=valuesForItem(item,headers), end=colLetter(Math.max(headers.length-1,0)); const data=await googleSheetsRequest(`/values/${encodeURIComponent(`${quoteTab(GOOGLE_SHEET_TAB)}!A:${end}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({majorDimension:'ROWS',values:[row]})}); return {action:'appended',updatedRange:data.updates?.updatedRange||''}; }

function mergeInventory() {
  const base = cachedSheetItems || readLocalInventory();
  const admin = readAdminData();
  const hidden = new Set(admin.hiddenIds || []);
  const merged = base.filter(item => !hidden.has(String(item.id))).map(item => ({ ...item, ...(admin.overrides?.[String(item.id)] || {}) }));
  const baseIds = new Set(merged.map(item => String(item.id)));
  for (const item of (admin.additions || [])) { const alreadyInSheet = item.sheetRow && base.some(x => Number(x.sourceNumber) + 1 === Number(item.sheetRow)); if (!baseIds.has(String(item.id)) && !alreadyInSheet) merged.push(item); }
  return merged;
}
function adminAuth(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !adminSessions.has(token)) return res.status(401).json({ error: 'Admin login required.' });
  next();
}
function safeImageUrl(raw) {
  const value = normalizeImageUrl(raw);
  if (!value) return '';
  if (value.startsWith('/photos/')) return value;
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? value : ''; } catch { return ''; }
}
function cleanText(v, max = 300) { return String(v ?? '').trim().slice(0, max); }
function validStatus(s) { return ['available', 'sold', 'unavailable', 'needs_review'].includes(s); }
function normalize(s) {
  return String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(v => String(v).trim())) rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); if (row.some(v => String(v).trim())) rows.push(row); }
  return rows;
}
function findColumn(headers, aliases) {
  const normalized = headers.map(normalize);
  for (const alias of aliases) {
    const a = normalize(alias);
    const exact = normalized.findIndex(h => h === a);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const a = normalize(alias);
    const partial = normalized.findIndex(h => h && (h.includes(a) || a.includes(h)));
    if (partial >= 0) return partial;
  }
  return -1;
}
function valueAt(row, index) { return index >= 0 ? String(row[index] ?? '').trim() : ''; }
function parsePrice(value) {
  const cleaned = String(value ?? '').replace(/[₱,$\s]/g, '').replace(/,/g, '').replace(/php/ig, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function parseStatus(value) {
  const s = normalize(value);
  if (s.includes('sold')) return 'sold';
  if (s.includes('unavailable') || s.includes('not available') || s.includes('out of stock')) return 'unavailable';
  if (s === 'available' || s.includes('in stock') || s.includes('available now')) return 'available';
  return 'needs_review';
}
function splitInclusions(value) {
  if (!value) return [];
  return String(value).split(/\s*(?:\+|;|\||\u2022|\n)\s*|,\s*/).map(x => x.trim()).filter(Boolean).slice(0, 20);
}
const BRAND_NAMES = ['AgfaPhoto', 'Fujifilm', 'Panasonic', 'Olympus', 'Praktica', 'Samsung', 'Canon', 'Nikon', 'Sony', 'Ricoh', 'Pentax', 'Casio', 'Sanyo', 'JVC', 'Kodak', 'GE', 'HP'];
function splitBrandModel(raw, explicitBrand = '') {
  let brand = cleanText(explicitBrand, 80);
  let model = cleanText(raw, 160);
  if (!brand) {
    const found = BRAND_NAMES.find(b => normalize(model).startsWith(normalize(b) + ' ' ) || normalize(model) === normalize(b));
    if (found) brand = found;
  }
  if (brand && normalize(model).startsWith(normalize(brand) + ' ')) model = model.slice(brand.length).trim();
  return { brand: brand || 'Camera', model: model || 'Model not listed' };
}
function normalizeImageUrl(url) {
  const value = cleanText(url, 1200);
  if (!value) return '';

  // Accept common Google Drive share links and convert them to an embeddable thumbnail.
  // This means existing Photo URL cells do not need to be edited one by one.
  const driveMatch = value.match(/drive\.google\.com\/(?:file\/d\/|thumbnail\?id=|uc\?(?:[^#]*&)?id=|open\?(?:[^#]*&)?id=)([a-zA-Z0-9_-]+)/)
    || value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    const fileId = driveMatch[1];
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  }
  return value;
}
function localPhotoFor(brand, model, usageCounts) {
  const items = readLocalInventory();
  const targetModel = normalize(model);
  const targetFull = normalize(`${brand} ${model}`);
  let matches = items.filter(x => normalize(x.brand) === normalize(brand) && normalize(x.model) === targetModel && x.imageUrl);
  if (!matches.length) matches = items.filter(x => normalize(`${x.brand} ${x.model}`) === targetFull && x.imageUrl);
  if (!matches.length && !brand) matches = items.filter(x => normalize(x.model) === targetModel && x.imageUrl);
  if (!matches.length) return '';
  const key = targetFull || targetModel;
  const index = usageCounts.get(key) || 0;
  usageCounts.set(key, index + 1);
  return matches[Math.min(index, matches.length - 1)].imageUrl || '';
}
function parseSheetRows(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw new Error('The Google Sheet returned no camera rows. Check that the correct tab has a header row and listing data.');
  const headers = rows[0].map(h => String(h ?? '').trim());
  const col = {
    model: findColumn(headers, ['camera model', 'camera', 'model', 'camera name', 'product name']),
    brand: findColumn(headers, ['brand', 'camera brand', 'manufacturer']),
    price: findColumn(headers, ['presyo', 'price', 'selling price', 'amount', 'price php']),
    issues: findColumn(headers, ['issues kondisyon', 'issues condition', 'issues', 'known issues', 'condition notes', 'issue']),
    condition: findColumn(headers, ['condition', 'condition status', 'physical condition']),
    inclusions: findColumn(headers, ['inclusions', 'included items', 'inclusions accessories', 'accessories']),
    status: findColumn(headers, ['status', 'listing status', 'availability']),
    link: findColumn(headers, ['link', 'seller link', 'original link', 'listing link', 'instagram link', 'source link']),
    image: findColumn(headers, ['photo url', 'photo', 'image url', 'image', 'camera photo', 'picture url', 'image link']),
    notes: findColumn(headers, ['notes', 'remarks', 'additional notes'])
  };
  if (col.model < 0 || col.price < 0) throw new Error(`Could not find required columns. Headers detected: ${headers.join(', ')}`);
  const result = [];
  const photoUseCounts = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawModel = valueAt(row, col.model);
    const price = parsePrice(valueAt(row, col.price));
    if (!rawModel || price === null) continue;
    const parsed = splitBrandModel(rawModel, valueAt(row, col.brand));
    const issues = valueAt(row, col.issues);
    const condition = valueAt(row, col.condition) || (issues ? 'See known issues below' : 'Condition details to be confirmed');
    const sellerUrl = valueAt(row, col.link);
    const directImage = normalizeImageUrl(valueAt(row, col.image));
    const imageUrl = directImage || localPhotoFor(parsed.brand, parsed.model, photoUseCounts);
    result.push({
      id: `sheet-${i + 1}-${normalize(parsed.brand + '-' + parsed.model).replace(/\s+/g, '-')}`,
      sourceNumber: i,
      brand: parsed.brand,
      model: parsed.model,
      price,
      condition,
      issues: issues || 'Not specified in the sheet',
      inclusions: splitInclusions(valueAt(row, col.inclusions)),
      status: parseStatus(valueAt(row, col.status)),
      imageUrl,
      instagramUrl: sellerUrl,
      sellerUrl,
      notes: valueAt(row, col.notes),
      source: 'google_sheets'
    });
  }
  if (!result.length) throw new Error('The sheet was read, but no rows had both a camera model and a valid price.');
  return result;
}
async function refreshSheetInventory() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(SHEET_CSV_URL, { headers: { 'Accept': 'text/csv,text/plain;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`Google Sheets returned HTTP ${response.status}. Check the sheet's sharing settings.`);
      const text = await response.text();
      const responseText = text.trim().toLowerCase();
      if (responseText.startsWith('<!doctype') || responseText.startsWith('<html')) throw new Error('Google Sheets returned a sign-in page instead of CSV. Set General access to Anyone with the link (Viewer), or publish the sheet to the web.');
      const items = parseSheetRows(text);
      cachedSheetItems = items;
      sheetState = { source: 'google_sheets', status: 'connected', lastSync: new Date().toISOString(), lastError: null, count: items.length };
      return items;
    } catch (error) {
      sheetState = { ...sheetState, status: cachedSheetItems ? 'stale' : 'fallback', lastError: cleanText(error.message || error, 500) };
      return cachedSheetItems || readLocalInventory();
    } finally { refreshInFlight = null; }
  })();
  return refreshInFlight;
}
function currentInventory() { return mergeInventory(); }

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'CAMBOT', version: '0.2.0', dataSource: sheetState.source, syncStatus: sheetState.status }));
app.get('/api/sync-status', (_req, res) => res.json({ ...sheetState, configured: Boolean(SHEET_ID || process.env.GOOGLE_SHEET_CSV_URL), writeBackConfigured: Boolean(GOOGLE_SERVICE_ACCOUNT_JSON), refreshIntervalSeconds: SYNC_INTERVAL_MS / 1000 }));
app.get('/api/contact-options', (_req, res) => res.json({ instagram: safeContactUrl(PUBLIC_INSTAGRAM_URL), messenger: safeContactUrl(PUBLIC_MESSENGER_URL), whatsapp: safeContactUrl(PUBLIC_WHATSAPP_URL) }));
app.get('/api/inventory', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(currentInventory());
});
app.post('/api/admin/login', (req, res) => {
  const supplied = String(req.body.password || '');
  if (!crypto.timingSafeEqual(Buffer.from(supplied.padEnd(256, '\0').slice(0,256)), Buffer.from(String(ADMIN_PASSWORD).padEnd(256, '\0').slice(0,256))) || supplied.length !== ADMIN_PASSWORD.length) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now());
  res.json({ ok: true, token });
});
app.post('/api/admin/logout', adminAuth, (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  adminSessions.delete(token); res.json({ ok: true });
});
app.get('/api/admin/summary', adminAuth, (_req, res) => {
  const items = currentInventory();
  res.json({ total: items.length, available: items.filter(x => x.status === 'available').length, sold: items.filter(x => x.status === 'sold').length, unavailable: items.filter(x => x.status === 'unavailable').length, needsReview: items.filter(x => x.status === 'needs_review').length, sheetCount: cachedSheetItems?.length || 0, localCount: readAdminData().additions.length, interestCount: readArrayFile(LEADS_DATA).length, writeBackConfigured: Boolean(GOOGLE_SERVICE_ACCOUNT_JSON) });
});
app.get('/api/admin/duplicates', adminAuth, (req, res) => res.json({ matches: duplicateMatches(req.query.brand, req.query.model, req.query.excludeId || '') }));
app.get('/api/admin/activity', adminAuth, (_req, res) => res.json(readArrayFile(ACTIVITY_DATA).slice(0, 200)));
app.get('/api/admin/interests', adminAuth, (_req, res) => res.json(readArrayFile(LEADS_DATA).slice(0, 200)));
app.post('/api/admin/inventory', adminAuth, async (req, res) => {
  const brand = cleanText(req.body.brand, 80), model = cleanText(req.body.model, 120), price = Number(req.body.price);
  if (!brand || !model || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Brand, model, and a valid non-negative price are required.' });
  const duplicates = duplicateMatches(brand, model);
  if (duplicates.length && !req.body.confirmDuplicate) return res.status(409).json({ error: 'A similar brand/model already exists. Confirm if this is a separate unit.', duplicates });
  const admin = readAdminData();
  const item = { id: `admin-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, brand, model, price,
    condition: cleanText(req.body.condition, 500), issues: cleanText(req.body.issues, 500), imageUrl: safeImageUrl(req.body.imageUrl),
    instagramUrl: cleanText(req.body.instagramUrl, 1000), sellerUrl: cleanText(req.body.instagramUrl, 1000), reviewed: true,
    inclusions: Array.isArray(req.body.inclusions) ? req.body.inclusions.map(x => cleanText(x, 80)).filter(Boolean).slice(0,20) : cleanText(req.body.inclusions, 300).split(',').map(x=>x.trim()).filter(Boolean),
    status: validStatus(req.body.status) ? req.body.status : 'available', notes: cleanText(req.body.notes, 500), source: 'admin' };
  admin.additions.unshift(item); writeAdminData(admin); logActivity('camera_added', { cameraId: item.id, camera: `${item.brand} ${item.model}`, source: 'admin' }); let sheetSync = 'local_only'; if (GOOGLE_SERVICE_ACCOUNT_JSON) { try { const result = await writeItemToGoogleSheet(item); sheetSync = result.action; const rowMatch = String(result.updatedRange || '').match(/!(?:[A-Z]+)(\d+)/); if (rowMatch) { item.sheetRow = Number(rowMatch[1]); const saved = readAdminData(); const stored = saved.additions.find(x => x.id === item.id); if (stored) { stored.sheetRow = item.sheetRow; writeAdminData(saved); } } await refreshSheetInventory(); } catch (e) { sheetSync = `failed: ${cleanText(e.message, 180)}`; } } res.status(201).json({ ...item, sheetSync });
});
app.patch('/api/admin/inventory/:id', adminAuth, async (req, res) => {
  const id = String(req.params.id); const admin = readAdminData();
  let item = admin.additions.find(x => String(x.id) === id);
  if (item) {
    for (const field of ['brand','model','condition','issues','notes','instagramUrl','sellerUrl']) if (req.body[field] !== undefined) item[field] = cleanText(req.body[field], 1000);
    if (req.body.imageUrl !== undefined) item.imageUrl = safeImageUrl(req.body.imageUrl);
    if (req.body.price !== undefined && Number.isFinite(Number(req.body.price)) && Number(req.body.price) >= 0) item.price = Number(req.body.price);
    if (req.body.status !== undefined && validStatus(req.body.status)) { const oldStatus = item.status; item.status = req.body.status; if (oldStatus !== item.status) logActivity('status_changed', { cameraId: id, camera: `${item.brand} ${item.model}`, from: oldStatus, to: item.status }); }
    if (req.body.inclusions !== undefined) item.inclusions = Array.isArray(req.body.inclusions) ? req.body.inclusions.map(x=>cleanText(x,80)).filter(Boolean) : cleanText(req.body.inclusions,300).split(',').map(x=>x.trim()).filter(Boolean);
    writeAdminData(admin); logActivity('camera_updated', { cameraId: item.id, camera: `${item.brand} ${item.model}`, changes: Object.keys(req.body) }); let sheetSync = 'local_only'; if (item.sheetRow && GOOGLE_SERVICE_ACCOUNT_JSON) { try { sheetSync = (await writeItemToGoogleSheet(item, item.sheetRow)).action; await refreshSheetInventory(); } catch (e) { sheetSync = `failed: ${cleanText(e.message, 180)}`; } } return res.json({ ...item, sheetSync });
  }
  const exists = (cachedSheetItems || readLocalInventory()).find(x => String(x.id) === id);
  if (!exists) return res.status(404).json({ error: 'Camera not found.' });
  const patch = { ...(admin.overrides[id] || {}) };
  for (const field of ['brand','model','condition','issues','notes','instagramUrl','sellerUrl']) if (req.body[field] !== undefined) patch[field] = cleanText(req.body[field], 1000);
  if (req.body.imageUrl !== undefined) patch.imageUrl = safeImageUrl(req.body.imageUrl);
  if (req.body.price !== undefined && Number.isFinite(Number(req.body.price)) && Number(req.body.price) >= 0) patch.price = Number(req.body.price);
  if (req.body.status !== undefined && validStatus(req.body.status)) { const oldStatus = patch.status || exists.status; patch.status = req.body.status; if (oldStatus !== patch.status) logActivity('status_changed', { cameraId: id, camera: `${exists.brand} ${exists.model}`, from: oldStatus, to: patch.status }); }
  if (req.body.inclusions !== undefined) patch.inclusions = Array.isArray(req.body.inclusions) ? req.body.inclusions.map(x=>cleanText(x,80)).filter(Boolean) : cleanText(req.body.inclusions,300).split(',').map(x=>x.trim()).filter(Boolean);
  admin.overrides[id] = patch; writeAdminData(admin); logActivity('camera_updated', { cameraId: id, camera: `${patch.brand || exists.brand} ${patch.model || exists.model}`, changes: Object.keys(req.body), source: exists.source || 'google_sheets' }); let sheetSync = 'local_override'; if (exists.source === 'google_sheets' && GOOGLE_SERVICE_ACCOUNT_JSON) { try { sheetSync = (await writeItemToGoogleSheet({ ...exists, ...patch }, Number(exists.sourceNumber) + 1)).action; await refreshSheetInventory(); } catch (e) { sheetSync = `failed: ${cleanText(e.message, 180)}`; } } res.json({ ...exists, ...patch, sheetSync });
});
app.delete('/api/admin/inventory/:id', adminAuth, (req, res) => {
  const id = String(req.params.id); const admin = readAdminData();
  const additionIndex = admin.additions.findIndex(x => String(x.id) === id);
  if (additionIndex >= 0) { const [removed] = admin.additions.splice(additionIndex, 1); writeAdminData(admin); logActivity('camera_removed', { cameraId: id, camera: `${removed.brand} ${removed.model}` }); return res.json({ ok: true, removed: 'local' }); }
  const exists = (cachedSheetItems || readLocalInventory()).some(x => String(x.id) === id);
  if (!exists) return res.status(404).json({ error: 'Camera not found.' });
  if (!admin.hiddenIds.includes(id)) admin.hiddenIds.push(id);
  writeAdminData(admin); logActivity('camera_hidden', { cameraId: id, camera: `${(cachedSheetItems || readLocalInventory()).find(x => String(x.id) === id)?.brand || ''} ${(cachedSheetItems || readLocalInventory()).find(x => String(x.id) === id)?.model || ''}` }); res.json({ ok: true, removed: 'hidden' });
});
// Public interest capture: records the click before the customer is sent to the chosen social channel.
app.post('/api/interests', (req, res) => {
  const cameraId = cleanText(req.body.cameraId, 160);
  const channel = ['instagram', 'messenger', 'whatsapp'].includes(String(req.body.channel)) ? String(req.body.channel) : 'messenger';
  const item = currentInventory().find(x => String(x.id) === cameraId);
  if (!item) return res.status(404).json({ error: 'Camera listing not found. Refresh the catalogue and try again.' });
  if (item.status === 'sold' || item.status === 'unavailable') return res.status(409).json({ error: 'This listing is not currently available for interest.' });
  const leads = readArrayFile(LEADS_DATA);
  const lead = { id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), cameraId, camera: `${item.brand} ${item.model}`, price: item.price, channel, status: 'new' };
  leads.unshift(lead); writeArrayFile(LEADS_DATA, leads.slice(0, 2000));
  logActivity('customer_interest', { cameraId, camera: lead.camera, channel, leadId: lead.id });
  res.status(201).json({ ok: true, leadId: lead.id, message: 'Interest recorded.' });
});
app.patch('/api/admin/interests/:id', adminAuth, (req, res) => {
  const leads = readArrayFile(LEADS_DATA); const lead = leads.find(x => x.id === String(req.params.id));
  if (!lead) return res.status(404).json({ error: 'Interest record not found.' });
  const status = ['new', 'contacted', 'converted', 'not_interested'].includes(req.body.status) ? req.body.status : lead.status;
  lead.status = status; lead.adminNote = cleanText(req.body.adminNote, 500); lead.updatedAt = new Date().toISOString(); writeArrayFile(LEADS_DATA, leads);
  logActivity('interest_updated', { leadId: lead.id, camera: lead.camera, status }); res.json(lead);
});

// Legacy endpoints remain for compatibility with the original local catalogue.
app.post('/api/inventory', (req, res) => {
  const brand = cleanText(req.body.brand, 80), model = cleanText(req.body.model, 120), price = Number(req.body.price);
  if (!brand || !model || !Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Brand, model, and a valid non-negative price are required.' });
  const items = readLocalInventory();
  const item = { id: `cam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, brand, model, price, condition: cleanText(req.body.condition,500), issues: cleanText(req.body.issues,500), imageUrl: safeImageUrl(req.body.imageUrl), instagramUrl: cleanText(req.body.instagramUrl,1000), reviewed:false, inclusions: Array.isArray(req.body.inclusions) ? req.body.inclusions.map(x=>cleanText(x,80)).filter(Boolean).slice(0,20) : cleanText(req.body.inclusions,300).split(',').map(x=>x.trim()).filter(Boolean), status: validStatus(req.body.status) ? req.body.status : 'needs_review', notes: cleanText(req.body.notes,500) };
  items.unshift(item); writeInventory(items); res.status(201).json(item);
});
app.patch('/api/inventory/:id', (req, res) => {
  const items = readLocalInventory(), index = items.findIndex(x => x.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Camera not found in local inventory.' });
  const item = items[index];
  for (const field of ['brand','model','condition','issues','notes','imageUrl','instagramUrl']) if (req.body[field] !== undefined) item[field] = cleanText(req.body[field], field.endsWith('Url') ? 1000 : 500);
  if (req.body.price !== undefined && Number.isFinite(Number(req.body.price)) && Number(req.body.price) >= 0) item.price = Number(req.body.price);
  if (req.body.status !== undefined && validStatus(req.body.status)) { const oldStatus = item.status; item.status = req.body.status; if (oldStatus !== item.status) logActivity('status_changed', { cameraId: id, camera: `${item.brand} ${item.model}`, from: oldStatus, to: item.status }); }
  writeInventory(items); res.json(item);
});
app.post('/api/inventory/bulk-review', (req, res) => {
  const action = cleanText(req.body.action, 40);
  const items = readLocalInventory();
  const targets = items.filter(x => x.status === 'needs_review');
  if (action === 'approve_details') {
    targets.forEach(x => { x.reviewed = true; x.notes = cleanText(x.notes, 500).replace(/\s*\[Details reviewed\]$/,'') + ' [Details reviewed]'; });
  } else if (action === 'mark_available') {
    targets.forEach(x => { x.status = 'available'; x.reviewed = true; x.notes = cleanText(x.notes, 500).replace(/\s*\[Details reviewed\]$/,''); });
  } else if (action === 'mark_sold') {
    targets.forEach(x => { x.status = 'sold'; x.reviewed = true; });
  } else return res.status(400).json({ error: 'Unsupported bulk review action.' });
  writeInventory(items); res.json({ ok: true, updated: targets.length, action });
});
app.delete('/api/inventory/:id', (req, res) => {
  const items = readLocalInventory(), filtered = items.filter(x => x.id !== req.params.id);
  if (filtered.length === items.length) return res.status(404).json({ error: 'Camera not found in local inventory.' });
  writeInventory(filtered); res.json({ ok: true });
});

// Read-only catalogue assistant: only recommends items whose sheet/local status is Available.
app.post('/api/chat', async (req, res) => {
  const message = cleanText(req.body.message, 1000);
  if (!message) return res.status(400).json({ error: 'Please enter a message.' });
  if (!cachedSheetItems && !sheetState.lastSync) await refreshSheetInventory();
  const items = currentInventory();
  const lower = message.toLowerCase();
  const budgetMatch = lower.match(/(?:under|below|budget(?: is)?|around|₱|php\s*)(?:\s*₱?\s*)([\d,]+)/i);
  let budget = budgetMatch ? Number(budgetMatch[1].replace(/,/g, '')) : null;
  if (/\b(5k|five k)\b/.test(lower)) budget = 5000;
  if (/\b(10k|ten k)\b/.test(lower)) budget = 10000;
  const brand = ['canon','sony','fujifilm','nikon','panasonic','samsung','olympus','jvc','casio','pentax'].find(b => lower.includes(b));
  const asksPhotos = /photo|photos|picture|pictures|sample|actual pic|actual photo|may picture|may pic|send pic|send photo|itsura/i.test(lower);
  const available = items.filter(x => x.status === 'available' && (!budget || x.price <= budget) && (!brand || x.brand.toLowerCase() === brand));
  if (available.length) return res.json({ reply: asksPhotos ? 'Sure! Here are the available matches. Open a product photo or the original seller listing to view more.' : `Got it! Based on what you shared, here ${available.length === 1 ? 'is an option' : 'are a few options'} to check:`, products: available.slice(0, 5) });
  const needsReview = items.filter(x => x.status === 'needs_review' && (!budget || x.price <= budget) && (!brand || x.brand.toLowerCase() === brand));
  if (needsReview.length) return res.json({ reply: asksPhotos ? `I found ${needsReview.length} possible match(es), but availability still needs confirmation. Open a listing to see its photo and seller link when available.` : `I found ${needsReview.length} possible match${needsReview.length > 1 ? 'es' : ''}, but their availability still needs confirmation.`, products: [], needsReview: needsReview.slice(0, 5) });
  if (/price|presyo|magkano|how much/.test(lower)) return res.json({ reply: 'I can help check the price. Which camera model are you asking about?', products: [] });
  return res.json({ reply: 'Hi! I can help you look for a camera. Do you have a budget in mind, or a brand you prefer—like Canon, Sony, or Fujifilm?', products: [] });
});

// Try immediately, then refresh in the background. If the sheet is private/unreachable, the local catalogue remains available.
refreshSheetInventory().catch(() => {});
setInterval(() => { refreshSheetInventory().catch(() => {}); }, SYNC_INTERVAL_MS).unref();
app.listen(PORT, () => console.log(`CAMBOT is running at http://localhost:${PORT}`));
