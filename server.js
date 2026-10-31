```js
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// server.js, public/, and data/ are all at the repository root.
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data', 'inventory.json');
const PUBLIC = path.join(ROOT, 'public');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC));

function readInventory() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeInventory(items) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(items, null, 2));
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function validStatus(status) {
  return ['available', 'sold', 'needs_review'].includes(status);
}

// Explicit homepage route. express.static also serves index.html automatically.
app.get('/', (_req, res) => {
  const indexPath = path.join(PUBLIC, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return res.status(500).send(
      'CAMBOT setup error: public/index.html was not found.'
    );
  }

  res.sendFile(indexPath);
});

// Google Sheets CSV synchronization.
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSfEK_r3BdwNRMY8xrfP0KLsbswT5GnEHVevI4KxpKYLRS9owSsLObBeO91CvKPzTAhaAbiLeYZqyfi/pub?output=csv';

let sheetSyncRunning = false;
let lastSheetSync = null;
let lastSheetSyncError = null;

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;

      row.push(cell);

      if (row.some(value => value.trim() !== '')) {
        rows.push(row);
      }

      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }

  if (cell !== '' || row.length) {
    row.push(cell);

    if (row.some(value => value.trim() !== '')) {
      rows.push(row);
    }
  }

  if (!rows.length) return [];

  const headers = rows.shift().map(header =>
    header.replace(/^\uFEFF/, '').trim().toLowerCase()
  );

  return rows.map(values => {
    const object = {};

    headers.forEach((header, index) => {
      object[header] = (values[index] || '').trim();
    });

    return object;
  });
}

function normalizeSheetStatus(value) {
  const status = String(value || '').trim().toLowerCase();

  if (status === 'available') return 'available';
  if (status === 'sold') return 'sold';

  // Unknown statuses are never treated as available.
  return 'needs_review';
}

function sheetPrice(value) {
  const raw = String(value || '').trim();
  const numeric = Number(raw.replace(/[^\d.-]/g, ''));

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return {
    price: numeric,
    priceLabel: raw
  };
}

async function syncInventoryFromSheet() {
  if (sheetSyncRunning) return;

  sheetSyncRunning = true;

  try {
    const response = await fetch(SHEET_CSV_URL, {
      headers: {
        'User-Agent': 'CAMBOT-Inventory-Sync/1.0'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(
        `Google Sheets returned HTTP ${response.status}`
      );
    }

    const csvText = await response.text();
    const trimmedCSV = csvText.trim();

    // Never overwrite inventory with an HTML error page.
    if (
      !trimmedCSV ||
      /^<!DOCTYPE html/i.test(trimmedCSV) ||
      /^<html/i.test(trimmedCSV)
    ) {
      throw new Error(
        'The published Google Sheets link did not return CSV data.'
      );
    }

    const rows = parseCSV(csvText);

    if (
      !rows.length ||
      !Object.hasOwn(rows[0], 'camera model')
    ) {
      throw new Error(
        'CSV is missing the "Camera model" column.'
      );
    }

    const current = readInventory();
    const next = [...current];
    const seenIds = new Set();
    let imported = 0;

    for (const row of rows) {
      const model = cleanText(row['camera model'], 120);

      if (!model) continue;

      const parsedPrice = sheetPrice(row['presyo']);

      if (!parsedPrice) {
        continue;
      }

      const link = cleanText(row['link'], 1000);

      const brand = (
        model.match(/^[A-Za-z]+/) || ['Unknown']
      )[0];

      const sheetRow = cleanText(row['#'], 30);

      const identity = link
        ? `url:${link}`
        : `row:${sheetRow}:${model.toLowerCase()}`;

      let index = link
        ? next.findIndex(item =>
            item.instagramUrl &&
            item.instagramUrl.trim() === link
          )
        : -1;

      if (index < 0) {
        index = next.findIndex(item =>
          item.source === 'google_sheets' &&
          item.sheetIdentity === identity
        );
      }

      const old = index >= 0 ? next[index] : {};

      const item = {
        ...old,

        id: old.id ||
          `sheet-${sheetRow || Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,

        brand: cleanText(old.brand || brand, 80),
        model,

        price: parsedPrice.price,
        priceLabel: parsedPrice.priceLabel,

        condition: cleanText(
          row['issues / kondisyon'],
          500
        ),

        issues: cleanText(
          row['issues / kondisyon'],
          500
        ),

        inclusions: cleanText(
          row['inclusions'],
          500
        )
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),

        status: normalizeSheetStatus(row['status']),

        instagramUrl: link,
        sheetRow,
        sheetIdentity: identity,
        source: 'google_sheets',

        reviewed: Boolean(old.reviewed),

        notes: [
          parsedPrice.priceLabel.includes('*')
            ? 'Price contains an asterisk in Google Sheets; verify its meaning.'
            : '',
          old.notes || ''
        ]
          .filter(Boolean)
          .join(' ')
          .slice(0, 500)
      };

      if (index >= 0) {
        next[index] = item;
      } else {
        next.push(item);
        index = next.length - 1;
      }

      seenIds.add(item.id);
      imported++;
    }

    if (!imported) {
      throw new Error(
        'No valid inventory rows were imported.'
      );
    }

    // Remove stale Google Sheets entries while preserving
    // records created locally through the app.
    const finalItems = next.filter(item =>
      item.source !== 'google_sheets' ||
      seenIds.has(item.id)
    );

    writeInventory(finalItems);

    lastSheetSync = new Date().toISOString();
    lastSheetSyncError = null;

    console.log(
      `[CAMBOT Sync] Success: ${imported} sheet listings processed at ${lastSheetSync}`
    );
  } catch (error) {
    lastSheetSyncError = error.message;

    console.error(
      '[CAMBOT Sync] Failed:',
      error.message
    );
  } finally {
    sheetSyncRunning = false;
  }
}

// Health check.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'CAMBOT',
    version: '0.1.0'
  });
});

// Google Sheets sync status.
app.get('/api/sync-status', (_req, res) => {
  res.json({
    syncing: sheetSyncRunning,
    lastSync: lastSheetSync,
    error: lastSheetSyncError
  });
});

// Get all inventory.
app.get('/api/inventory', (_req, res) => {
  res.json(readInventory());
});

// Create an inventory item.
app.post('/api/inventory', (req, res) => {
  const brand = cleanText(req.body.brand, 80);
  const model = cleanText(req.body.model, 120);
  const price = Number(req.body.price);

  if (
    !brand ||
    !model ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    return res.status(400).json({
      error: 'Brand, model, and a valid non-negative price are required.'
    });
  }

  const items = readInventory();

  const item = {
    id: `cam-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`,

    brand,
    model,
    price,

    condition: cleanText(req.body.condition, 500),
    issues: cleanText(req.body.issues, 500),

    imageUrl: cleanText(req.body.imageUrl, 1000),
    instagramUrl: cleanText(req.body.instagramUrl, 1000),

    reviewed: false,

    inclusions: Array.isArray(req.body.inclusions)
      ? req.body.inclusions
          .map(value => cleanText(value, 80))
          .filter(Boolean)
          .slice(0, 20)
      : cleanText(req.body.inclusions, 300)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),

    status: validStatus(req.body.status)
      ? req.body.status
      : 'needs_review',

    notes: cleanText(req.body.notes, 500)
  };

  items.unshift(item);
  writeInventory(items);

  res.status(201).json(item);
});

// Update an inventory item.
app.patch('/api/inventory/:id', (req, res) => {
  const items = readInventory();

  const index = items.findIndex(
    item => item.id === req.params.id
  );

  if (index < 0) {
    return res.status(404).json({
      error: 'Camera not found.'
    });
  }

  const item = items[index];

  for (const field of [
    'brand',
    'model',
    'condition',
    'issues',
    'notes',
    'imageUrl',
    'instagramUrl'
  ]) {
    if (req.body[field] !== undefined) {
      item[field] = cleanText(
        req.body[field],
        field.endsWith('Url') ? 1000 : 500
      );
    }
  }

  if (req.body.reviewed !== undefined) {
    item.reviewed = Boolean(req.body.reviewed);
  }

  if (
    req.body.price !== undefined &&
    Number.isFinite(Number(req.body.price)) &&
    Number(req.body.price) >= 0
  ) {
    item.price = Number(req.body.price);
  }

  if (
    req.body.status !== undefined &&
    validStatus(req.body.status)
  ) {
    item.status = req.body.status;
  }

  if (req.body.inclusions !== undefined) {
    item.inclusions = Array.isArray(req.body.inclusions)
      ? req.body.inclusions
          .map(value => cleanText(value, 80))
          .filter(Boolean)
      : cleanText(req.body.inclusions, 300)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
  }

  items[index] = item;
  writeInventory(items);

  res.json(item);
});

// Bulk review actions. These do not change stock availability.
app.post('/api/inventory/bulk-review', (req, res) => {
  const action = cleanText(req.body.action, 40);

  if (
    action === 'mark_available' ||
    action === 'mark_sold'
  ) {
    return res.status(400).json({
      error: 'Availability and sold status must be updated per listing using PATCH /api/inventory/:id.'
    });
  }

  if (action !== 'approve_details') {
    return res.status(400).json({
      error: 'Unsupported bulk review action.'
    });
  }

  const items = readInventory();

  const targets = items.filter(
    item => item.status === 'needs_review'
  );

  targets.forEach(item => {
    item.reviewed = true;

    item.notes = cleanText(item.notes, 500)
      .replace(/\s*\[Details reviewed\]$/, '');

    if (!item.notes.includes('[Details reviewed]')) {
      item.notes = (
        item.notes + ' [Details reviewed]'
      )
        .trim()
        .slice(0, 500);
    }
  });

  writeInventory(items);

  res.json({
    ok: true,
    updated: targets.length,
    action
  });
});

// Delete an inventory item.
app.delete('/api/inventory/:id', (req, res) => {
  const items = readInventory();

  const filtered = items.filter(
    item => item.id !== req.params.id
  );

  if (filtered.length === items.length) {
    return res.status(404).json({
      error: 'Camera not found.'
    });
  }

  writeInventory(filtered);

  res.json({ ok: true });
});

// Deterministic assistant: exact model matches first.
// Only confirmed stock is recommended.
app.post('/api/chat', (req, res) => {
  const message = cleanText(req.body.message, 1000);

  if (!message) {
    return res.status(400).json({
      error: 'Please enter a message.'
    });
  }

  const items = readInventory();
  const lower = message.toLowerCase();

  const budgetMatch = lower.match(
    /(?:under|below|budget(?: is)?|around|₱|php\s*)(?:\s*₱?\s*)([\d,]+)/i
  );

  let budget = budgetMatch
    ? Number(budgetMatch[1].replace(/,/g, ''))
    : null;

  if (/\b(5k|five k)\b/.test(lower)) {
    budget = 5000;
  }

  if (/\b(10k|ten k)\b/.test(lower)) {
    budget = 10000;
  }

  const asksPhotos =
    /photo|photos|picture|pictures|sample|actual pic|actual photo|may picture|may pic|send pic|send photo|itsura/i
      .test(lower);

  const normalize = value =>
    String(value || '')
      .toLowerCase()
      .replace(/[–—]/g, '-')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

  const normalizedMessage = normalize(message);

  // Match model names, including aliases separated by "/".
  const modelMatches = items
    .map(item => {
      const modelParts = String(item.model || '')
        .split('/')
        .map(part => normalize(part))
        .filter(part => part.length >= 3);

      const fullModel = normalize(item.model);

      const matchedPart = modelParts
        .filter(part => normalizedMessage.includes(part))
        .sort((a, b) => b.length - a.length)[0];

      const fullMatch =
        fullModel.length >= 3 &&
        normalizedMessage.includes(fullModel);

      return {
        item,
        matched: fullMatch || Boolean(matchedPart),
        matchLength: fullMatch
          ? fullModel.length
          : (matchedPart || '').length
      };
    })
    .filter(result => result.matched)
    .sort((a, b) => b.matchLength - a.matchLength)
    .map(result => result.item);

  // Exact model queries use Google Sheets as the source of truth.
  if (modelMatches.length) {
    const sheetModelMatches = modelMatches.filter(
      item => item.source === 'google_sheets'
    );

    if (!sheetModelMatches.length) {
      return res.json({
        reply: 'This model only matched an unverified legacy inventory record. Please confirm its current listing and availability with the team.',
        products: []
      });
    }

    const matchedItems = sheetModelMatches.filter(
      item => !budget || Number(item.price) <= budget
    );

    if (!matchedItems.length) {
      return res.json({
        reply: 'I found this model in the Google Sheets inventory, but no matching listing meets your budget.',
        products: []
      });
    }

    const availableExact = matchedItems.filter(
      item => item.status === 'available'
    );

    if (availableExact.length) {
      return res.json({
        reply: asksPhotos
          ? 'Here are the matching listings. Open the listing link to view the seller photos.'
          : 'Here are the matching camera listings:',
        products: availableExact.slice(0, 5)
      });
    }

    const reviewExact = matchedItems.filter(
      item => item.status === 'needs_review'
    );

    if (reviewExact.length) {
      return res.json({
        reply: 'I found the requested model, but its availability still needs confirmation. Please check the individual listing before making a purchase.',
        products: [],
        needsReview: reviewExact.slice(0, 5)
      });
    }

    const soldExact = matchedItems.filter(
      item => item.status === 'sold'
    );

    if (soldExact.length) {
      return res.json({
        reply: 'I found the requested model, but the matching listing is marked sold.',
        products: soldExact.slice(0, 5)
      });
    }
  }

  const brands = [
    'canon',
    'sony',
    'fujifilm',
    'nikon',
    'panasonic',
    'samsung',
    'olympus',
    'jvc',
    'casio',
    'pentax'
  ];

  const brand = brands.find(value =>
    new RegExp('\\b' + value + '\\b', 'i').test(lower)
  );

  const matchesFilters = item =>
    item.source === 'google_sheets' &&
    (!budget || Number(item.price) <= budget) &&
    (!brand || normalize(item.brand) === normalize(brand));

  const available = items.filter(
    item =>
      item.status === 'available' &&
      matchesFilters(item)
  );

  if (available.length) {
    return res.json({
      reply: asksPhotos
        ? 'Here are available inventory matches. Open a listing link to view the seller photos.'
        : `Here ${
            available.length === 1 ? 'is an option' : 'are some options'
          } to check:`,
      products: available.slice(0, 5)
    });
  }

  const needsReview = items.filter(
    item =>
      item.status === 'needs_review' &&
      matchesFilters(item)
  );

  if (needsReview.length) {
    return res.json({
      reply: 'I found possible matches, but their availability still needs confirmation. I will not label them available until the listings are checked.',
      products: [],
      needsReview: needsReview.slice(0, 5)
    });
  }

  if (/price|presyo|magkano|how much/i.test(lower)) {
    return res.json({
      reply: 'Which exact camera model would you like me to check?',
      products: []
    });
  }

  return res.json({
    reply: 'Hi! I can help you find a camera. Tell me the exact model, preferred brand, or budget.',
    products: []
  });
});

// Start the server and synchronize inventory.
app.listen(PORT, () => {
  console.log(`CAMBOT is running on port ${PORT}`);
  console.log(`Serving frontend from: ${PUBLIC}`);
  console.log(`Inventory file: ${DATA}`);

  // Initial sync, followed by a sync every 60 seconds.
  syncInventoryFromSheet();
  setInterval(syncInventoryFromSheet, 60 * 1000);
});
```
