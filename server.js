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

  if (index < 0) {
    return res.status(404).json({ error: 'Camera listing not found.' });
  }

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
    if (!isValidStatus(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
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

// Chat endpoint: deterministic inventory lookup; it does not invent availability.
app.post('/api/chat', function (req, res) {
  const message = cleanText(req.body && req.body.message, 1000);
  if (!message) {
    return res.status(400).json({ error: 'Please enter a message.' });
  }

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
      return res.json({
        reply: sheetMatches.length
          ? 'I found that model, but its listed price is above your stated budget.'
          : 'I could not verify that model in the current Google Sheets inventory. Please ask the team to confirm the listing.',
        products: []
      });
    }

    const availableMatches = budgetMatches.filter(function (item) { return item.status === 'available'; });
    if (availableMatches.length > 0) {
      return res.json({
        reply: asksForPhotos
          ? 'Here are the matching available listings. Open the listing link to view its photos.'
          : 'Here are the matching available camera listings:',
        products: availableMatches.slice(0, 5)
      });
    }

    const reviewMatches = budgetMatches.filter(function (item) { return item.status === 'needs_review'; });
    if (reviewMatches.length > 0) {
      return res.json({
        reply: 'I found the model, but its availability still needs confirmation. Please check with the team before relying on its stock status.',
        products: [],
        needsReview: reviewMatches.slice(0, 5)
      });
    }

    return res.json({
      reply: 'I found the matching listing, but it is marked as sold.',
      products: budgetMatches.slice(0, 5)
    });
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
    return res.json({
      reply: asksForPhotos
        ? 'Here are available inventory matches. Open a listing link to view the seller photos.'
        : 'Here are some camera listings you can check:',
      products: available.slice(0, 5)
    });
  }

  const needsReview = filtered.filter(function (item) { return item.status === 'needs_review'; });
  if (needsReview.length > 0) {
    return res.json({
      reply: 'I found possible matches, but their availability still needs confirmation. Please check with the team first.',
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
    reply: 'Hi! I can help you find a camera. Tell me the exact camera model, preferred brand, or your budget.',
    products: []
  });
});

// Force a synchronization without exposing the private file path.
app.post('/api/sync-now', async function (_req, res) {
  if (isSyncing) {
    return res.status(409).json({ ok: false, message: 'A synchronization is already running.' });
  }
  await syncInventoryFromSheet();
  return res.json({
    ok: lastSyncError === null,
    lastSync: lastSyncAt,
    error: lastSyncError
  });
});

// JSON response for unknown API routes; ordinary unknown pages get a normal 404.
app.use('/api', function (_req, res) {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use(function (req, res) {
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
