/**
 * weaponsManager.js — GTA V / FiveM weapons.json loader, cache & search engine
 *
 * - On first load: downloads from DurtyFree data dumps
 * - Caches to api/data/weapons.json for subsequent starts
 * - Builds in-memory index for fast name / category search
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WEAPONS_URL = 'https://raw.githubusercontent.com/DurtyFree/gta-v-data-dumps/refs/heads/master/weapons.json';
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'weapons.json');

let weaponsData = null; // raw array from JSON
let searchIndex = []; // flat array of { name, hash, category, lowerName }
let categoryStats = {}; // { "GROUP_RIFLE": 10, ... }
let dlcStats = {}; // { "basegame": 40, ... }
let totalCount = 0;
let loaded = false;

// ─── Download ────────────────────────────────────────────────────────────────

function downloadWeapons() {
  return new Promise((resolve, reject) => {
    console.log('[s4-doctor-api] Downloading weapons.json from DurtyFree/gta-v-data-dumps...');

    const request = https.get(WEAPONS_URL, { timeout: 60000 }, (res) => {
      // Handle redirects (GitHub raw sometimes 301/302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { timeout: 60000 }, (redirectRes) => {
          handleResponse(redirectRes, resolve, reject);
        }).on('error', reject);
        res.resume();
        return;
      }
      handleResponse(res, resolve, reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

function handleResponse(res, resolve, reject) {
  if (res.statusCode !== 200) {
    reject(new Error(`HTTP ${res.statusCode}`));
    res.resume();
    return;
  }

  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(raw);

      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      fs.writeFileSync(CACHE_FILE, raw, 'utf8');
      console.log('[s4-doctor-api] weapons.json cached to api/data/weapons.json');
      resolve(parsed);
    } catch (err) {
      reject(err);
    }
  });
  res.on('error', reject);
}

// ─── Build Index ─────────────────────────────────────────────────────────────

function buildIndex(data) {
  searchIndex = [];
  categoryStats = {};
  dlcStats = {};
  totalCount = 0;

  for (const weapon of data) {
    if (typeof weapon !== 'object' || weapon === null || !weapon.Name) continue;

    const name = weapon.Name;
    const category = weapon.Category || 'UNKNOWN';
    const dlc = weapon.DlcName || 'unknown';

    // Translated name for search
    const translatedName = (weapon.TranslatedLabel && weapon.TranslatedLabel.English) || '';

    // Convert decimal hash to hex format (0x...) for easier search
    let hexHash = weapon.Hash ? '0x' + (weapon.Hash >>> 0).toString(16).toUpperCase() : '';

    searchIndex.push({
      name,
      hash: weapon.Hash || 0,
      signedHash: weapon.IntHash || 0,
      hexHash,
      category,
      dlc,
      lowerName: name.toLowerCase(),
      lowerTranslated: translatedName.toLowerCase(),
      damageType: (weapon.DamageType || '').toLowerCase(),
    });

    categoryStats[category] = (categoryStats[category] || 0) + 1;
    dlcStats[dlc] = (dlcStats[dlc] || 0) + 1;
    totalCount++;
  }

  searchIndex.sort((a, b) => a.lowerName.localeCompare(b.lowerName));
}

// ─── Load ────────────────────────────────────────────────────────────────────

async function loadWeapons() {
  if (loaded && weaponsData) return;

  // Try cache first
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      weaponsData = JSON.parse(raw);
      buildIndex(weaponsData);
      loaded = true;
      console.log(`[s4-doctor-api] Loaded ${totalCount} weapons from cache (${Object.keys(categoryStats).length} categories)`);
      return;
    }
  } catch (err) {
    console.warn('[s4-doctor-api] Weapons cache read failed, will download:', err.message);
  }

  // Download
  try {
    weaponsData = await downloadWeapons();
    buildIndex(weaponsData);
    loaded = true;
    console.log(`[s4-doctor-api] Loaded ${totalCount} weapons from download (${Object.keys(categoryStats).length} categories)`);
  } catch (err) {
    console.error('[s4-doctor-api] Failed to load weapons:', err.message);
  }
}

// ─── Refresh (re-download) ──────────────────────────────────────────────────

async function refreshWeapons() {
  try {
    weaponsData = await downloadWeapons();
    buildIndex(weaponsData);
    loaded = true;
    return { success: true, totalCount, categories: Object.keys(categoryStats).length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Get overview: category stats + DLC stats */
function getOverview() {
  return {
    success: true,
    totalWeapons: totalCount,
    categories: Object.entries(categoryStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count })),
    dlcs: Object.entries(dlcStats)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  };
}

/** List weapons by category (e.g. "GROUP_RIFLE", "GROUP_MELEE") */
function getWeaponsByCategory(category) {
  const upper = category.toUpperCase();
  const matching = searchIndex.filter((w) => w.category.toUpperCase() === upper);

  if (matching.length === 0) {
    return { success: false, error: `No weapons found for category: ${category}` };
  }

  return {
    success: true,
    category: matching[0].category,
    count: matching.length,
    weapons: matching.map((w) => ({
      name: w.name,
      hash: w.hash,
      hexHash: w.hexHash,
      dlc: w.dlc,
    })),
  };
}

/** Get a single weapon's full details by name or hash */
function getWeaponByName(nameOrHash) {
  if (!weaponsData) return { success: false, error: 'weapons not loaded' };

  const lower = nameOrHash.toLowerCase();
  const isHash = nameOrHash.startsWith('0x') || nameOrHash.startsWith('0X');

  let found = null;
  for (const weapon of weaponsData) {
    if (typeof weapon !== 'object' || !weapon.Name) continue;

    if (isHash) {
      let hexHash = weapon.Hash ? '0x' + (weapon.Hash >>> 0).toString(16).toLowerCase() : '';
      if (hexHash === lower) {
        found = weapon;
        break;
      }
    } else {
      if (weapon.Name.toLowerCase() === lower) {
        found = weapon;
        break;
      }
    }
  }

  if (!found) {
    // Try numeric hash
    const numHash = parseInt(nameOrHash);
    if (!isNaN(numHash)) {
      found = weaponsData.find((w) => w.Hash === numHash || w.IntHash === numHash);
    }
  }

  if (!found) {
    return { success: false, error: `Weapon not found: ${nameOrHash}` };
  }

  let hexHash = found.Hash ? '0x' + (found.Hash >>> 0).toString(16).toUpperCase() : '';

  return {
    success: true,
    weapon: {
      name: found.Name,
      hash: found.Hash,
      signedHash: found.IntHash,
      hexHash,
      dlc: found.DlcName,
      category: found.Category,
      translatedName: found.TranslatedLabel ? {
        english: found.TranslatedLabel.English || null,
        label: found.TranslatedLabel.Name || null,
      } : null,
      modelName: found.ModelName || null,
      ammoType: found.AmmoType || null,
      ammoModelName: found.AmmoModelName || null,
      damageType: found.DamageType || null,
      isVehicleWeapon: found.IsVehicleWeapon || false,
      flags: found.Flags || [],
      components: (found.Components || []).map(c => c.Name),
      tints: (found.Tints || []).map(t => (t.TranslatedLabel && t.TranslatedLabel.English) || t.Index.toString()),
    },
  };
}

/** Search weapons by name, hash, category or keyword */
function searchWeapons(query, opts = {}) {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'query is required' };
  }

  const limit = Math.min(Math.max(parseInt(opts.limit) || 25, 1), 100);
  const catFilter = opts.category ? opts.category.toUpperCase() : null;
  const dlcFilter = opts.dlc ? opts.dlc.toLowerCase() : null;
  const lower = query.toLowerCase();
  const isHash = query.startsWith('0x') || query.startsWith('0X');

  // Convert camelCase/PascalCase to underscore_lower for matching
  const snakeLower = query
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

  const scored = [];

  for (const entry of searchIndex) {
    if (catFilter && entry.category.toUpperCase() !== catFilter) continue;
    if (dlcFilter && entry.dlc.toLowerCase() !== dlcFilter) continue;

    let score = 0;

    if (isHash) {
      if (entry.hexHash.toLowerCase() === lower) {
        score = 100;
      } else if (entry.hexHash.toLowerCase().startsWith(lower)) {
        score = 80;
      } else {
        continue;
      }
    } else {
      // Name search — try both original and snake_case
      if (entry.lowerName === lower || entry.lowerName === snakeLower) {
        score = 100;
      } else if (entry.lowerName.startsWith(lower) || entry.lowerName.startsWith(snakeLower)) {
        score = 80;
      } else if (entry.lowerName.includes(lower) || entry.lowerName.includes(snakeLower)) {
        score = 60;
      } else if (entry.lowerTranslated.includes(lower)) {
        score = 50; // translated name match (e.g. "Knife")
      } else if (entry.damageType.includes(lower) || entry.category.toLowerCase().includes(lower)) {
        score = 30;
      } else {
        continue;
      }
    }

    scored.push({ ...entry, score });
  }

  scored.sort((a, b) => b.score - a.score || a.lowerName.localeCompare(b.lowerName));

  const results = scored.slice(0, limit).map((s) => ({
    name: s.name,
    hash: s.hash,
    hexHash: s.hexHash,
    category: s.category,
    dlc: s.dlc,
    score: s.score,
  }));

  return {
    success: true,
    query,
    count: results.length,
    totalMatches: scored.length,
    results,
  };
}

/** Check if weapons are loaded */
function isLoaded() {
  return loaded;
}

/** Get loading status */
function getStatus() {
  return {
    loaded,
    totalWeapons: totalCount,
    categoryCount: Object.keys(categoryStats).length,
    dlcCount: Object.keys(dlcStats).length,
    cacheFile: CACHE_FILE,
    cacheExists: fs.existsSync(CACHE_FILE),
  };
}

module.exports = {
  loadWeapons,
  refreshWeapons,
  getOverview,
  getWeaponsByCategory,
  getWeaponByName,
  searchWeapons,
  isLoaded,
  getStatus,
};
