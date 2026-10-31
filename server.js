
nakabukas na
Good! 🔥 Ngayon, gagawin natin nang maayos para ma-connect ang CAMBOT sa Facebook Messenger at Instagram DM nang hindi nasisira ang inventory system mo.

STEP 1 — Gumawa muna ng backup
Sa VS Code, tingnan ang kaliwang Explorer panel.

Hanapin ang server.js.
I-right-click ito at piliin ang Copy Path kung kailangan mong makita ang lokasyon nito.
Buksan ang File Explorer at pumunta sa folder ng CAMBOT:
C:\Users\chloe\Downloads\CAMBOT-Inventory-Review-Photos
Kopyahin ang server.js at i-paste sa parehong folder.
Palitan ang pangalan ng kopya sa server-backup.js.
Huwag mong palitan o burahin ang original na server.js.

STEP 2 — Kumpirmahin natin ang mga file
Balik sa VS Code. Sa kaliwang Explorer panel, dapat makita mo ang mga file na gaya ng:

server.js
package.json
public folder, kung mayroon
data folder, kung mayroon
Sabihin mo sa akin:
Nagawa mo na ba ang server-backup.js?

Kapag oo, ibibigay ko ang susunod na hakbang. Hindi muna natin papalitan ang buong code hangga't hindi ligtas ang backup mo.

nagawa na
Ayos! 🔥 May backup na tayo, kaya mas safe na ang next step.

STEP 2 — Buksan ang bagong file sa VS Code
May ginawa akong updated CAMBOT server code para sa Facebook Messenger + Instagram DM integration. Dahil hindi gumagana ang download link sa iyo, subukan natin ang ibang paraan para hindi ka na ma-stuck.

Gawin mo muna ito:

Sa VS Code, i-click ang File → New Text File.
I-click ang File → Save As.
I-save sa folder na CAMBOT-Inventory-Review-Photos.
Pangalanan itong server-new.js.
Important: Huwag mong i-save bilang server.js at huwag munang i-upload sa GitHub. Panatilihin natin ang original at backup.

Kapag nagawa mo na ang server-new.js
Sabihin mo lang: READY NA.

Pagkatapos, ibibigay ko ang code sa maayos na mga bahagi para maipasok natin ito nang hindi aksidenteng nawawala ang inventory features.

ready na
Perfect! 🔥 Nasa tamang step na tayo. May server-backup.js ka na at nagawa mo na rin ang server-new.js.

Pero may isang importanteng bagay: hindi tayo basta gagawa ng panibagong server mula sa simula. Dapat mapanatili ang kasalukuyang CAMBOT features mo, kabilang ang Google Sheets inventory sync, camera search, presyo, availability, at review endpoints.

Gagawin natin ang integration sa paraang puwedeng i-test muna bago palitan ang production server.

STEP 3 — Kunin natin ang kasalukuyang code
Para maibigay ko ang tamang bagong code, kailangan kong makita ang laman ng original mong server.js. Ayokong magbigay ng code na maaaring makasira sa existing inventory system mo.

Gawin mo ito sa VS Code:

Sa kaliwang Explorer, i-click ang original na server.js — huwag ang server-new.js.
Pindutin ang Ctrl + A para piliin ang buong code.
Pindutin ang Ctrl + C para kopyahin.
Bumalik dito sa ChatGPT at i-paste ang code sa chat.
Kung masyadong mahaba at hindi kasya, hatiin natin sa ilang bahagi. Ipadala mo muna ang unang bahagi at lagyan ng label na PART 1.

Pagkatapos, gagawin natin ang updated version na may:

💬 Facebook Messenger integration
📸 Instagram DM integration
📦 Existing Google Sheets inventory sync
🔎 Camera search, presyo, at product links
Huwag munang i-deploy sa Render o palitan ang original na server.js. Susuriin muna natin ang code bago magpatuloy.

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSfEK_r3BdwNRMY8xrfP0KLsbswT5GnEHVevI4KxpKYLRS9owSsLObBeO91CvKPzTAhaAbiLeYZqyfi/pub?output=csv';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

let isSyncing = false;
let lastSyncAt = null;
let lastSyncError = null;

function readInventory() {
  try {
    if (!fs.existsSync(INVENTORY_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[CAMBOT] Could not read inventory:', error.message);
    return [];
  }
}

function writeInventory(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Inventory must be an array.');
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = INVENTORY_FILE + '.tmp';
  fs.writeFileSync(temporaryFile, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(temporaryFile, INVENTORY_FILE);
}

function cleanText(value, maxLength) {
  const limit = Number.isFinite(maxLength) ? maxLength : 300;
  return String(value === undefined || value === null ? '' : value)
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, limit);
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 8);
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

// CSV parser supports quoted commas, escaped quotes, and line breaks inside quotes.
function parseCSV(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];

    if (insideQuotes) {
      if (character === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      insideQuotes = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some(function (value) { return String(value).trim() !== ''; })) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some(function (value) { return String(value).trim() !== ''; })) {
      rows.push(row);
    }
  }

  if (insideQuotes) {
    throw new Error('The Google Sheets CSV contains an unclosed quoted field.');
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map(function (values) {
    const record = {};
    headers.forEach(function (header, index) {
      record[header] = String(values[index] === undefined ? '' : values[index]).trim();
    });
    return record;
  });
}

function parsePrice(value) {
  const raw = cleanText(value, 80);
  if (!raw) return null;

  // Handles examples such as "₱5,000", "PHP 5000", and "5000".
  const numericText = raw.replace(/[^0-9.\-]/g, '');
  const amount = Number(numericText);

  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount: amount, label: raw };
}

function normalizeStatus(value) {
  const status = cleanText(value, 80).toLowerCase();

  if (/^(available|in stock|instock|on hand|for sale|active)$/.test(status)) {
    return 'available';
  }
  if (/^(sold|sold out|unavailable)$/.test(status)) {
    return 'sold';
  }
  return 'needs_review';
}

function splitInclusions(value) {
  return cleanText(value, 700)
    .split(/[,;\n]/)
    .map(function (part) { return part.trim(); })
    .filter(Boolean)
    .slice(0, 30);
}

function inferBrand(model) {
  const knownBrands = [
    'Canon', 'Sony', 'Fujifilm', 'Fujifilm', 'Nikon', 'Panasonic',
    'Samsung', 'Olympus', 'Kodak', 'Casio', 'Pentax', 'JVC', 'Leica'
  ];
  const lowerModel = String(model || '').toLowerCase();
  for (let i = 0; i < knownBrands.length; i += 1) {
    if (lowerModel.indexOf(knownBrands[i].toLowerCase()) !== -1) {
      return knownBrands[i];
    }
  }
  return 'Other';
}

async function syncInventoryFromSheet() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const response = await fetch(SHEET_CSV_URL, {
      headers: { 'User-Agent': 'CAMBOT-Inventory-Sync/1.0' },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      // String concatenation avoids accidental template-literal syntax errors.
      throw new Error('Google Sheets returned HTTP ' + response.status);
    }

    const csvText = await response.text();
    const trimmed = csvText.trim();

    if (!trimmed || /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      throw new Error('Google Sheets did not return published CSV data. Check the sheet publishing settings and URL.');
    }

    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      throw new Error('The Google Sheets CSV has no inventory rows. Existing inventory was kept.');
    }

    const requiredColumns = ['camera model', 'presyo'];
    const firstRow = rows[0];
    requiredColumns.forEach(function (column) {
      if (!Object.prototype.hasOwnProperty.call(firstRow, column)) {
        throw new Error('Google Sheets is missing the required column: ' + column);
      }
    });

    const existingItems = readInventory();
    const nextItems = existingItems.slice();
    const importedIds = new Set();
    let processed = 0;

    rows.forEach(function (row, rowIndex) {
      const model = cleanText(row['camera model'], 160);
      const parsedPrice = parsePrice(row['presyo']);

      if (!model || !parsedPrice) return;

      const sheetNumber = cleanText(row['#'], 40) || String(rowIndex + 2);
      const listingLink = cleanText(row['link'], 1500);
      const identity = listingLink
        ? 'link:' + listingLink
        : 'row:' + sheetNumber + ':' + model.toLowerCase();

      let itemIndex = -1;

      if (listingLink) {
        itemIndex = nextItems.findIndex(function (item) {
          return item && (
            cleanText(item.instagramUrl, 1500) === listingLink ||
            cleanText(item.sheetIdentity, 1600) === identity
          );
        });
      }

      if (itemIndex < 0) {
        itemIndex = nextItems.findIndex(function (item) {
          return item && item.source === 'google_sheets' && item.sheetIdentity === identity;
        });
      }

      const oldItem = itemIndex >= 0 ? nextItems[itemIndex] : {};
      const issueText = cleanText(row['issues / kondisyon'], 700);
      const item = Object.assign({}, oldItem, {
        id: oldItem.id || makeId('sheet-' + sheetNumber),
        brand: cleanText(oldItem.brand || inferBrand(model), 80),
        model: model,
        price: parsedPrice.amount,
        priceLabel: parsedPrice.label,
        condition: issueText,
        issues: issueText,
        inclusions: splitInclusions(row['inclusions']),
        status: normalizeStatus(row['status']),
        instagramUrl: listingLink,
        sheetRow: sheetNumber,
        sheetIdentity: identity,
        source: 'google_sheets',
        updatedAt: new Date().toISOString()
      });

      if (itemIndex >= 0) {
        nextItems[itemIndex] = item;
      } else {
        nextItems.push(item);
        itemIndex = nextItems.length - 1;
      }

      importedIds.add(item.id);
      processed += 1;
    });

    if (processed === 0) {
      throw new Error('No valid camera listings were found. Existing inventory was kept.');
    }

    // Keep locally created listings; remove only stale Google Sheets records.
    const finalItems = nextItems.filter(function (item) {
      return item.source !== 'google_sheets' || importedIds.has(item.id);
    });

    writeInventory(finalItems);
    lastSyncAt = new Date().toISOString();
    lastSyncError = null;
    console.log('[CAMBOT Sync] Success: ' + processed + ' sheet listings processed at ' + lastSyncAt);
  } catch (error) {
    lastSyncError = error && error.message ? error.message : String(error);
    console.error('[CAMBOT Sync] Failed: ' + lastSyncError);
  } finally {
    isSyncing = false;
  }
}

function isValidStatus(status) {
  return ['available', 'sold', 'needs_review'].indexOf(status) !== -1;
}

// Homepage
app.get('/', function (_req, res) {
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return res.status(500).send('CAMBOT setup error: public/index.html was not found.');
  }
  return res.sendFile(indexFile);
});

// Basic service health
app.get('/api/health', function (_req, res) {
  res.json({ ok: true, app: 'CAMBOT', version: '0.1.1' });
});

// Google Sheets synchronization status
app.get('/api/sync-status', function (_req, res) {
  res.json({
    syncing: isSyncing,
    lastSync: lastSyncAt,
    error: lastSyncError
  });
});

// Retrieve all inventory listings
app.get('/api/inventory', function (_req, res) {
  res.json(readInventory());
});

// Create a manual inventory listing
app.post('/api/inventory', function (req, res) {
  const brand = cleanText(req.body.brand, 80);
  const model = cleanText(req.body.model, 160);
  const price = Number(req.body.price);

  if (!brand || !model || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({
      error: 'Brand, model, and a valid non-negative price are required.'
    });
  }

  const inclusions = Array.isArray(req.body.inclusions)
    ? req.body.inclusions.map(function (value)
…
Nakuha ko na ang buong original server.js mo! 👍 Hindi natin kailangang ulitin ang buong project. Idadagdag natin ang Facebook Messenger at Instagram DM integration habang pinapanatili ang existing inventory system.

STEP 4 — Ihanda ang server-new.js
Ang original mong code ay may Google Sheets sync, inventory CRUD, at /api/chat. May ilang pagbabago tayong kailangang gawin para sa Meta webhook:

Raw request body para ma-verify ang Meta webhook signature.
Webhook verification para maikonekta ang Meta Developer App.
Message handler para masagot ng CAMBOT ang customer gamit ang inventory mo.
Page Access Token para maipadala ang sagot sa Messenger o Instagram, depende sa Meta account configuration.
Status endpoint para masuri kung kumpleto ang environment variables.
Dahil mahaba ang original code mo, hindi ligtas na palitan ang buong file sa pamamagitan ng maliliit na code snippets na hindi pa nasusubukan sa aktuwal mong project.

Gawin muna natin ang unang pagbabago
Sa server-new.js, ilagay muna ito sa pinakataas:

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

Pagkatapos, huwag munang magdagdag ng ibang code.

Susunod nating gagawin
Ihahanda natin ang buong integration bilang isang kumpletong file, saka susuriin ang syntax bago i-deploy. Hindi pa ito nangangahulugang nakakonekta na ang Meta account mo; kailangan pa rin ang tamang permissions, Page Access Token, webhook subscription, at Render environment variables.

Mahalaga: Huwag mong ipadala rito ang access token o app secret mo. Siya lamang ang ilalagay sa Render Environment kapag handa na tayo.

ano next
Sige, tuloy tayo! 🔥 Pero para hindi ka mahirapan sa pagkopya ng napakaraming code, gagamitin natin ang original mong server.js bilang base.

STEP 5 — Ayusin muna ang server-new.js
Sa VS Code:

I-click ang server-new.js sa kaliwang Explorer.
Siguraduhing ang laman nito ay ang code na ito:
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || '';

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSfEK_r3BdwNRMY8xrfP0KLsbswT5GnEHVevI4KxpKYLRS9owSsLObBeO91CvKPzTAhaAbiLeYZqyfi/pub?output=csv';

Pindutin ang Ctrl + S.
Huwag munang patakbuhin o i-deploy ang file. Hindi pa kumpleto ang code na ito; inihahanda lang natin ang configuration.

STEP 6 — Kumpirmahin natin
Kapag nailagay at na-save mo na ang code, sabihin mo:

NA-SAVE NA

Pagkatapos, itutuloy natin ang webhook at message handler. Pananatilihin natin ang original mong inventory functions, at susuriin muna ang buong code bago ito gamitin sa Render.

isend mona lang ulit as buo wag na isaisa  try mo baka madownload kona, as txt kung pwede kas ikanina gumana ung txt file

Worked for 21s
Sige! Nakuha ko ulit ang dating complete CAMBOT server code. Ginawa ko na itong TXT file para subukan mong i-download, gaya ng gumana sa iyo kanina.

📄 I-download ang complete CAMBOT code
Kasama sa file ang:

✅ Google Sheets inventory synchronization
✅ Camera inventory at review endpoints
✅ Existing /api/chat functionality
✅ Facebook Messenger webhook integration
✅ Instagram messaging webhook integration
✅ Meta webhook signature verification
✅ /api/meta-status configuration check
Importanteng tandaan: Sinuri ko ang JavaScript syntax ng file, at pumasa ito sa syntax check. Pero hindi pa nito pinatutunayan na gumagana na ang Facebook at Instagram integration—kailangan pa rin ang tamang Meta permissions at Render environment variables.

Kapag na-download mo na
Buksan ang folder na CAMBOT-Inventory-Review-Photos.
I-backup muna ang kasalukuyang server.js.
Buksan ang na-download na TXT file.
Kopyahin ang buong laman papunta sa bagong server.js file, o palitan ang extension ng downloaded file mula .txt tungo sa .js.
Huwag muna mag-deploy hangga't hindi natin nakukumpirma na nasa tamang project folder ang file at kumpleto ang configuration.
Sabihin mo lang kung na-download mo na o kung nag-error pa rin ang download link.


CAMBOT-server-full.txt
Document
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSfEK_r3BdwNRMY8xrfP0KLsbswT5GnEHVevI4KxpKYLRS9owSsLObBeO91CvKPzTAhaAbiLeYZqyfi/pub?output=csv';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || '';
const META_IG_USER_ID = process.env.META_IG_USER_ID || '';

app.disable('x-powered-by');

// Keep the raw request body for Meta webhook signature validation.
app.use(express.json({
  limit: '1mb',
  verify: function (req, _res, buffer) {
    if (req.originalUrl.split('?')[0] === '/webhook/meta') {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

let isSyncing = false;
let lastSyncAt = null;
let lastSyncError = null;

function readInventory() {
  try {
    if (!fs.existsSync(INVENTORY_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[CAMBOT] Could not read inventory:', error.message);
    return [];
  }
}

function writeInventory(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Inventory must be an array.');
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = INVENTORY_FILE + '.tmp';
  fs.writeFileSync(temporaryFile, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(temporaryFile, INVENTORY_FILE);
}

function cleanText(value, maxLength) {
  const limit = Number.isFinite(maxLength) ? maxLength : 300;
  return String(value === undefined || value === null ? '' : value)
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, limit);
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 8);
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

// CSV parser supports quoted commas, escaped quotes, and line breaks inside quotes.
function parseCSV(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];

    if (insideQuotes) {
      if (character === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (character === '"') {
        insideQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      insideQuotes = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some(function (value) { return String(value).trim() !== ''; })) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some(function (value) { return String(value).trim() !== ''; })) {
      rows.push(row);
    }
  }

  if (insideQuotes) {
    throw new Error('The Google Sheets CSV contains an unclosed quoted field.');
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map(function (values) {
    const record = {};
    headers.forEach(function (header, index) {
      record[header] = String(values[index] === undefined ? '' : values[index]).trim();
    });
    return record;
  });
}

function parsePrice(value) {
  const raw = cleanText(value, 80);
  if (!raw) return null;
  const numericText = raw.replace(/[^0-9.\-]/g, '');
  const amount = Number(numericText);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount: amount, label: raw };
}

function normalizeStatus(value) {
  const status = cleanText(value, 80).toLowerCase();
  if (/^(available|in stock|instock|on hand|for sale|active)$/.test(status)) return 'available';
  if (/^(sold|sold out|unavailable)$/.test(status)) return 'sold';
  return 'needs_review';
}

function splitInclusions(value) {
  return cleanText(value, 700)
    .split(/[,;\n]/)
    .map(function (part) { return part.trim(); })
    .filter(Boolean)
    .slice(0, 30);
}

function inferBrand(model) {
  const knownBrands = [
    'Canon', 'Sony', 'Fujifilm', 'Nikon', 'Panasonic',
    'Samsung', 'Olympus', 'Kodak', 'Casio', 'Pentax', 'JVC', 'Leica'
  ];
  const lowerModel = String(model || '').toLowerCase();
  for (let i = 0; i < knownBrands.length; i += 1) {
    if (lowerModel.indexOf(knownBrands[i].toLowerCase()) !== -1) return knownBrands[i];
  }
  return 'Other';
}

async function syncInventoryFromSheet() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const response = await fetch(SHEET_CSV_URL, {
      headers: { 'User-Agent': 'CAMBOT-Inventory-Sync/1.0' },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error('Google Sheets returned HTTP ' + response.status);
    }

    const csvText = await response.text();
    const trimmed = csvText.trim();
    if (!trimmed || /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      throw new Error('Google Sheets did not return published CSV data. Check the sheet publishing settings and URL.');
    }

    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      throw new Error('The Google Sheets CSV has no inventory rows. Existing inventory was kept.');
    }

    const firstRow = rows[0];
    ['camera model', 'presyo'].forEach(function (column) {
      if (!Object.prototype.hasOwnProperty.call(firstRow, column)) {
        throw new Error('Google Sheets is missing the required column: ' + column);
      }
    });

    const existingItems = readInventory();
    const nextItems = existingItems.slice();
    const importedIds = new Set();
    let processed = 0;

    rows.forEach(function (row, rowIndex) {
      const model = cleanText(row['camera model'], 160);
      const parsedPrice = parsePrice(row['presyo']);
      if (!model || !parsedPrice) return;

      const sheetNumber = cleanText(row['#'], 40) || String(rowIndex + 2);
      const listingLink = cleanText(row['link'], 1500);
      const identity = listingLink
        ? 'link:' + listingLink
        : 'row:' + sheetNumber + ':' + model.toLowerCase();

      let itemIndex = -1;
      if (listingLink) {
        itemIndex = nextItems.findIndex(function (item) {
          return item && (
            cleanText(item.instagramUrl, 1500) === listingLink ||
            cleanText(item.sheetIdentity, 1600) === identity
          );
        });
      }
      if (itemIndex < 0) {
        itemIndex = nextItems.findIndex(function (item) {
          return item && item.source === 'google_sheets' && item.sheetIdentity === identity;
        });
      }

      const oldItem = itemIndex >= 0 ? nextItems[itemIndex] : {};
      const issueText = cleanText(row['issues / kondisyon'], 700);
      const item = Object.assign({}, oldItem, {
        id: oldItem.id || makeId('sheet-' + sheetNumber),
        brand: cleanText(oldItem.brand || inferBrand(model), 80),
        model: model,
        price: parsedPrice.amount,
        priceLabel: parsedPrice.label,
        condition: issueText,
        issues: issueText,
        inclusions: splitInclusions(row['inclusions']),
        status: normalizeStatus(row['status']),
        instagramUrl: listingLink,
        sheetRow: sheetNumber,
        sheetIdentity: identity,
        source: 'google_sheets',
        updatedAt: new Date().toISOString()
      });

      if (itemIndex >= 0) nextItems[itemIndex] = item;
      else {
        nextItems.push(item);
        itemIndex = nextItems.length - 1;
      }

      importedIds.add(item.id);
      processed += 1;
    });

    if (processed === 0) {
      throw new Error('No valid camera listings were found. Existing inventory was kept.');
    }

    const finalItems = nextItems.filter(function (item) {
      return item.source !== 'google_sheets' || importedIds.has(item.id);
    });

    writeInventory(finalItems);
    lastSyncAt = new Date().toISOString();
    lastSyncError = null;
    console.log('[CAMBOT Sync] Success: ' + processed + ' sheet listings processed at ' + lastSyncAt);
  } catch (error) {
    lastSyncError = error && error.message ? error.message : String(error);
    console.error('[CAMBOT Sync] Failed: ' + lastSyncError);
  } finally {
    isSyncing = false;
  }
}

function isValidStatus(status) {
  return ['available', 'sold', 'needs_review'].indexOf(status) !== -1;
}

// Shared deterministic chatbot logic used by web chat and Meta DMs.
function getChatResult(message) {
  const items = readInventory();
  const lower = message.toLowerCase();
  const normalizedMessage = lower.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

  let budget = null;
  const budgetMatch = lower.match(/(?:under|below|budget(?: is)?|around|php|₱)\s*₱?\s*([0-9][0-9,]*)/i);
  if (budgetMatch) {
    const parsedBudget = Number(budgetMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsedBudget)) budget = parsedBudget;
  }
  if (/\b5\s*k\b/.test(lower)) budget = 5000;
  if (/\b10\s*k\b/.test(lower)) budget = 10000;

  const asksForPhotos = /photo|photos|picture|pictures|sample|actual pic|actual photo|may picture|may pic|send pic|send photo/i.test(lower);
  const normalized = function (value) {
    return String(value || '').toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  };

  const matchedModels = items.map(function (item) {
    const model = normalized(item.model);
    const aliases = String(item.model || '').split('/').map(normalized).filter(function (part) {
      return part.length >= 3;
    });
    let length = 0;
    if (model.length >= 3 && normalizedMessage.indexOf(model) !== -1) length = model.length;
    aliases.forEach(function (alias) {
      if (normalizedMessage.indexOf(alias) !== -1 && alias.length > length) length = alias.length;
    });
    return { item: item, length: length };
  }).filter(function (result) { return result.length > 0; })
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (result) { return result.item; });

  if (matchedModels.length > 0) {
    const sheetMatches = matchedModels.filter(function (item) { return item.source === 'google_sheets'; });
    const budgetMatches = sheetMatches.filter(function (item) {
      return budget === null || Number(item.price) <= budget;
    });

    if (budgetMatches.length === 0) {
      return {
        reply: sheetMatches.length
          ? 'I found that model, but its listed price is above your stated budget.'
          : 'I could not verify that model in the current Google Sheets inventory. Please ask the team to confirm the listing.',
        products: []
      };
    }

    const availableMatches = budgetMatches.filter(function (item) { return item.status === 'available'; });
    if (availableMatches.length > 0) {
      return {
        reply: asksForPhotos
          ? 'Here are the matching available listings. Open the listing link to view its photos.'
          : 'Here are the matching available camera listings:',
        products: availableMatches.slice(0, 5)
      };
    }

    const reviewMatches = budgetMatches.filter(function (item) { return item.status === 'needs_review'; });
    if (reviewMatches.length > 0) {
      return {
        reply: 'I found the model, but its availability still needs confirmation. Please check with the team before relying on its stock status.',
        products: [],
        needsReview: reviewMatches.slice(0, 5)
      };
    }

    return {
      reply: 'I found the matching listing, but it is marked as sold.',
      products: budgetMatches.slice(0, 5)
    };
  }

  const knownBrands = [
    'canon', 'sony', 'fujifilm', 'nikon', 'panasonic', 'samsung',
    'olympus', 'kodak', 'casio', 'pentax', 'jvc', 'leica'
  ];
  const selectedBrand = knownBrands.find(function (brand) {
    return new RegExp('(^|\\s)' + brand + '(\\s|$)', 'i').test(normalizedMessage);
  });

  const filtered = items.filter(function (item) {
    if (item.source !== 'google_sheets') return false;
    if (budget !== null && Number(item.price) > budget) return false;
    if (selectedBrand && normalized(item.brand) !== selectedBrand) return false;
    return true;
  });

  const available = filtered.filter(function (item) { return item.status === 'available'; });
  if (available.length > 0) {
    return {
      reply: asksForPhotos
        ? 'Here are available inventory matches. Open a listing link to view the seller photos.'
        : 'Here are some camera listings you can check:',
      products: available.slice(0, 5)
    };
  }

  const needsReview = filtered.filter(function (item) { return item.status === 'needs_review'; });
  if (needsReview.length > 0) {
    return {
      reply: 'I found possible matches, but their availability still needs confirmation. Please check with the team first.',
      products: [],
      needsReview: needsReview.slice(0, 5)
    };
  }

  if (/price|presyo|magkano|how much/i.test(lower)) {
    return { reply: 'Which exact camera model would you like me to check?', products: [] };
  }

  return {
    reply: 'Hi! I can help you find a camera. Tell me the exact camera model, preferred brand, or your budget.',
    products: []
  };
}

function formatMetaReply(result) {
  let text = cleanText(result && result.reply, 1000);
  const products = Array.isArray(result && result.products) ? result.products.slice(0, 5) : [];

  if (products.length) {
    const lines = products.map(function (item, index) {
      const name = cleanText([item.brand, item.model].filter(Boolean).join(' '), 160);
      const price = cleanText(item.priceLabel, 80) ||
        (Number.isFinite(Number(item.price))
          ? '₱' + Number(item.price).toLocaleString('en-PH')
          : 'Price not confirmed');
      const link = cleanText(item.instagramUrl, 800);
      return (index + 1) + '. ' + name + '\nPrice: ' + price +
        (link ? '\nListing: ' + link : '');
    });
    text += '\n\n' + lines.join('\n\n');
  }

  if (result && Array.isArray(result.needsReview) && result.needsReview.length) {
    text += '\n\nSome listings need availability confirmation before purchase.';
  }

  return text.slice(0, 1900);
}

async function sendMetaMessage(recipientId, messageText) {
  if (!META_PAGE_ACCESS_TOKEN) {
    throw new Error('META_PAGE_ACCESS_TOKEN is not configured.');
  }

  const endpoint = 'https://graph.facebook.com/' + META_GRAPH_VERSION +
    '/me/messages?access_token=' + encodeURIComponent(META_PAGE_ACCESS_TOKEN);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: messageText }
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const body = await response.text();
    // Never log the request URL: it contains the access token.
    console.error('[CAMBOT Meta] Send failed, HTTP ' + response.status + ': ' + body.slice(0, 400));
    throw new Error('Meta message send failed with HTTP ' + response.status);
  }

  return response.json();
}

function verifyMetaSignature(req) {
  if (!META_APP_SECRET || !req.rawBody) return false;

  const signature = req.get('x-hub-signature-256');
  if (!signature || !signature.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleMetaEvent(event, platform) {
  // Meta may send delivery/read/postback events. Only answer incoming text messages.
  if (!event || !event.message || event.message.is_echo) return;

  const senderId = event.sender && event.sender.id;
  const messageText = event.message.text;
  if (!senderId || typeof messageText !== 'string') return;

  const message = cleanText(messageText, 1000);
  if (!message) return;

  const result = getChatResult(message);
  const reply = formatMetaReply(result);
  if (reply) {
    console.log('[CAMBOT Meta] Replying to an incoming ' + platform + ' message.');
    await sendMetaMessage(senderId, reply);
  }
}

// Homepage
app.get('/', function (_req, res) {
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) {
    return res.status(500).send('CAMBOT setup error: public/index.html was not found.');
  }
  return res.sendFile(indexFile);
});

// Basic service health
app.get('/api/health', function (_req, res) {
  res.json({ ok: true, app: 'CAMBOT', version: '0.2.0' });
});

// Google Sheets synchronization status
app.get('/api/sync-status', function (_req, res) {
  res.json({ syncing: isSyncing, lastSync: lastSyncAt, error: lastSyncError });
});

// Meta configuration status only; never return secret values.
app.get('/api/meta-status', function (_req, res) {
  res.json({
    webhookPath: '/webhook/meta',
    verifyTokenConfigured: Boolean(META_VERIFY_TOKEN),
    appSecretConfigured: Boolean(META_APP_SECRET),
    pageAccessTokenConfigured: Boolean(META_PAGE_ACCESS_TOKEN),
    instagramUserIdConfigured: Boolean(META_IG_USER_ID),
    graphVersion: META_GRAPH_VERSION
  });
});

// Meta webhook verification challenge.
app.get('/webhook/meta', function (req, res) {
  if (!META_VERIFY_TOKEN) {
    return res.status(500).send('Meta webhook verification is not configured.');
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN && challenge) {
    console.log('[CAMBOT Meta] Webhook verification succeeded.');
    return res.status(200).send(String(challenge));
  }

  return res.sendStatus(403);
});

// Meta webhook receiver. Verify signature before processing any event.
app.post('/webhook/meta', function (req, res) {
  if (!verifyMetaSignature(req)) {
    return res.status(401).send('Invalid webhook signature.');
  }

  const body = req.body || {};
  if (body.object !== 'page' && body.object !== 'instagram') {
    return res.sendStatus(404);
  }

  // Respond quickly so Meta does not retry while messages are being processed.
  res.sendStatus(200);

  const entries = Array.isArray(body.entry) ? body.entry : [];
  entries.forEach(function (entry) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    events.forEach(function (event) {
      const platform = body.object === 'instagram' ? 'Instagram' : 'Facebook Messenger';
      handleMetaEvent(event, platform).catch(function (error) {
        console.error('[CAMBOT Meta] Event handling failed:', error.message);
      });
    });
  });
});

// Retrieve all inventory listings
app.get('/api/inventory', function (_req, res) {
  res.json(readInventory());
});

// Create a manual inventory listing
app.post('/api/inventory', function (req, res) {
  const brand = cleanText(req.body.brand, 80);
  const model = cleanText(req.body.model, 160);
  const price = Number(req.body.price);

  if (!brand || !model || !Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'Brand, model, and a valid non-negative price are required.' });
  }

  const inclusions = Array.isArray(req.body.inclusions)
    ? req.body.inclusions.map(function (value) { return cleanText(value, 100); }).filter(Boolean).slice(0, 30)
    : splitInclusions(req.body.inclusions);

  const item = {
    id: makeId('manual'),
    brand: brand,
    model: model,
    price: price,
    priceLabel: cleanText(req.body.priceLabel, 80) || String(price),
    condition: cleanText(req.body.condition, 700),
    issues: cleanText(req.body.issues, 700),
    inclusions: inclusions,
    imageUrl: cleanText(req.body.imageUrl, 1500),
    instagramUrl: cleanText(req.body.instagramUrl, 1500),
    status: isValidStatus(req.body.status) ? req.body.status : 'needs_review',
    reviewed: false,
    source: 'manual',
    notes: cleanText(req.body.notes, 700),
    createdAt: new Date().toISOString()
  };

  const items = readInventory();
  items.unshift(item);
  try {
    writeInventory(items);
    return res.status(201).json(item);
  } catch (error) {
    console.error('[CAMBOT] Could not create listing:', error.message);
    return res.status(500).json({ error: 'Could not save the inventory listing.' });
  }
});

// Update one inventory listing
app.patch('/api/inventory/:id', function (req, res) {
  const items = readInventory();
  const index = items.findIndex(function (item) { return item.id === req.params.id; });

  if (index < 0) return res.status(404).json({ error: 'Camera listing not found.' });

  const item = Object.assign({}, items[index]);
  const textFields = [
    'brand', 'model', 'condition', 'issues', 'notes', 'imageUrl', 'instagramUrl', 'priceLabel'
  ];

  textFields.forEach(function (field) {
    if (req.body[field] !== undefined) {
      item[field] = cleanText(req.body[field], field.toLowerCase().indexOf('url') !== -1 ? 1500 : 700);
    }
  });

  if (req.body.price !== undefined) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'Price must be a valid non-negative number.' });
    }
    item.price = price;
  }

  if (req.body.status !== undefined) {
    if (!isValidStatus(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
    item.status = req.body.status;
  }

  if (req.body.inclusions !== undefined) {
    item.inclusions = Array.isArray(req.body.inclusions)
      ? req.body.inclusions.map(function (value) { return cleanText(value, 100); }).filter(Boolean).slice(0, 30)
      : splitInclusions(req.body.inclusions);
  }

  if (req.body.reviewed !== undefined) item.reviewed = Boolean(req.body.reviewed);
  item.updatedAt = new Date().toISOString();
  items[index] = item;

  try {
    writeInventory(items);
    return res.json(item);
  } catch (error) {
    console.error('[CAMBOT] Could not update listing:', error.message);
    return res.status(500).json({ error: 'Could not update the inventory listing.' });
  }
});

// Mark details reviewed for all listings that need review. Does not mark stock available.
app.post('/api/inventory/bulk-review', function (req, res) {
  if (req.body.action !== 'approve_details') {
    return res.status(400).json({ error: 'Unsupported bulk review action.' });
  }

  const items = readInventory();
  let updated = 0;
  items.forEach(function (item) {
    if (item.status === 'needs_review') {
      item.reviewed = true;
      item.notes = cleanText(item.notes, 700);
      if (item.notes.indexOf('[Details reviewed]') === -1) {
        item.notes = (item.notes + ' [Details reviewed]').trim().slice(0, 700);
      }
      updated += 1;
    }
  });

  try {
    writeInventory(items);
    return res.json({ ok: true, updated: updated, action: 'approve_details' });
  } catch (error) {
    console.error('[CAMBOT] Bulk review failed:', error.message);
    return res.status(500).json({ error: 'Could not save the review changes.' });
  }
});

// Delete one inventory listing
app.delete('/api/inventory/:id', function (req, res) {
  const items = readInventory();
  const filtered = items.filter(function (item) { return item.id !== req.params.id; });

  if (filtered.length === items.length) {
    return res.status(404).json({ error: 'Camera listing not found.' });
  }

  try {
    writeInventory(filtered);
    return res.json({ ok: true });
  } catch (error) {
    console.error('[CAMBOT] Could not delete listing:', error.message);
    return res.status(500).json({ error: 'Could not delete the inventory listing.' });
  }
});

// Web chat endpoint
app.post('/api/chat', function (req, res) {
  const message = cleanText(req.body && req.body.message, 1000);
  if (!message) return res.status(400).json({ error: 'Please enter a message.' });
  return res.json(getChatResult(message));
});

// Force a synchronization without exposing the private file path.
app.post('/api/sync-now', async function (_req, res) {
  if (isSyncing) {
    return res.status(409).json({ ok: false, message: 'A synchronization is already running.' });
  }
  await syncInventoryFromSheet();
  return res.json({ ok: lastSyncError === null, lastSync: lastSyncAt, error: lastSyncError });
});

// JSON response for unknown API routes; ordinary unknown pages get a normal 404.
app.use('/api', function (_req, res) {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use(function (_req, res) {
  res.status(404).send('Page not found.');
});

app.use(function (error, _req, res, _next) {
  console.error('[CAMBOT] Request error:', error && error.message ? error.message : error);
  if (res.headersSent) return;
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(PORT, function () {
  console.log('CAMBOT is running on port ' + PORT);
  console.log('Serving frontend from: ' + PUBLIC_DIR);
  console.log('Inventory file: ' + INVENTORY_FILE);
  syncInventoryFromSheet();
  setInterval(syncInventoryFromSheet, 60 * 1000);
});


