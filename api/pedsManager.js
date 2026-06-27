/**
* pedsManager.js — GTA V / FiveM peds.json loader, cache & search engine
*
* - On first load: downloads from DurtyFree data dumps
* - Caches to api/data/peds.json for subsequent starts
* - Builds in-memory index for fast name / type / DLC search
*/

const fs = require('fs');
const path = require('path');
const https = require('https');

const PEDS_URL = 'https://raw.githubusercontent.com/DurtyFree/gta-v-data-dumps/refs/heads/master/peds.json';
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'peds.json');

let pedsData = null;      // raw array from JSON
let searchIndex = [];     // flat array of { name, hash, hexHash, pedtype, dlc, lowerName }
let pedtypeStats = {};    // { "Animal": 12, "Civmale": 100, ... }
let dlcStats = {};        // { "basegame": 400, "mpHeist": 30, ... }
let totalCount = 0;
let loaded = false;

// ─── Download ────────────────────────────────────────────────────────────────

function downloadPeds() {
  return new Promise((resolve, reject) => {
    console.log('[s4-doctor-api] Downloading peds.json from DurtyFree/gta-v-data-dumps...');

    const request = https.get(PEDS_URL, { timeout: 60000 }, (res) => {
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
      console.log('[s4-doctor-api] peds.json cached to api/data/peds.json');
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
  pedtypeStats = {};
  dlcStats = {};
  totalCount = 0;

  for (const ped of data) {
    if (typeof ped !== 'object' || ped === null || !ped.Name) continue;

    const name = ped.Name;
    const pedtype = ped.Pedtype || 'Unknown';
    const dlc = ped.DlcName || 'unknown';

    // Translated name for search (English preferred)
    const translatedName = (ped.TranslatedDirectorName && ped.TranslatedDirectorName.English) || '';

    searchIndex.push({
      name,
      hash: ped.Hash || 0,
      signedHash: ped.SignedHash || 0,
      hexHash: ped.HexHash || '',
      pedtype,
      dlc,
      lowerName: name.toLowerCase(),
      lowerTranslated: translatedName.toLowerCase(),
      personality: (ped.Personality || '').toLowerCase(),
      relationshipGroup: (ped.RelationshipGroup || '').toLowerCase(),
    });

    pedtypeStats[pedtype] = (pedtypeStats[pedtype] || 0) + 1;
    dlcStats[dlc] = (dlcStats[dlc] || 0) + 1;
    totalCount++;
  }

  searchIndex.sort((a, b) => a.lowerName.localeCompare(b.lowerName));
}

// ─── Load ────────────────────────────────────────────────────────────────────

async function loadPeds() {
  if (loaded && pedsData) return;

  // Try cache first
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      pedsData = JSON.parse(raw);
      buildIndex(pedsData);
      loaded = true;
      console.log(`[s4-doctor-api] Loaded ${totalCount} peds from cache (${Object.keys(pedtypeStats).length} types)`);
      return;
    }
  } catch (err) {
    console.warn('[s4-doctor-api] Peds cache read failed, will download:', err.message);
  }

  // Download
  try {
    pedsData = await downloadPeds();
    buildIndex(pedsData);
    loaded = true;
    console.log(`[s4-doctor-api] Loaded ${totalCount} peds from download (${Object.keys(pedtypeStats).length} types)`);
  } catch (err) {
    console.error('[s4-doctor-api] Failed to load peds:', err.message);
  }
}

// ─── Refresh (re-download) ──────────────────────────────────────────────────

async function refreshPeds() {
  try {
    pedsData = await downloadPeds();
    buildIndex(pedsData);
    loaded = true;
    return { success: true, totalCount, pedtypes: Object.keys(pedtypeStats).length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Get overview: ped type stats + DLC stats */
function getOverview() {
  return {
    success: true,
    totalPeds: totalCount,
    pedtypes: Object.entries(pedtypeStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count })),
    dlcs: Object.entries(dlcStats)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  };
}

/** List peds by type (e.g. "Animal", "Civmale", "Civfemale") */
function getPedsByType(type) {
  const lower = type.toLowerCase();
  const matching = searchIndex.filter((p) => p.pedtype.toLowerCase() === lower);

  if (matching.length === 0) {
    return { success: false, error: `No peds found for type: ${type}` };
  }

  return {
    success: true,
    pedtype: matching[0].pedtype,
    count: matching.length,
    peds: matching.map((p) => ({
      name: p.name,
      hash: p.hash,
      hexHash: p.hexHash,
      dlc: p.dlc,
    })),
  };
}

/** List peds by DLC */
function getPedsByDlc(dlcName) {
  const lower = dlcName.toLowerCase();
  const matching = searchIndex.filter((p) => p.dlc.toLowerCase() === lower);

  if (matching.length === 0) {
    return { success: false, error: `No peds found for DLC: ${dlcName}` };
  }

  return {
    success: true,
    dlc: matching[0].dlc,
    count: matching.length,
    peds: matching.map((p) => ({
      name: p.name,
      hash: p.hash,
      hexHash: p.hexHash,
      pedtype: p.pedtype,
    })),
  };
}

/** Get a single ped's full details by name or hash */
function getPedByName(nameOrHash) {
  if (!pedsData) return { success: false, error: 'peds not loaded' };

  const lower = nameOrHash.toLowerCase();
  const isHash = nameOrHash.startsWith('0x') || nameOrHash.startsWith('0X');

  let found = null;
  for (const ped of pedsData) {
    if (typeof ped !== 'object' || !ped.Name) continue;

    if (isHash) {
      if ((ped.HexHash || '').toLowerCase() === lower) {
        found = ped;
        break;
      }
    } else {
      if (ped.Name.toLowerCase() === lower) {
        found = ped;
        break;
      }
    }
  }

  if (!found) {
    // Try numeric hash
    const numHash = parseInt(nameOrHash);
    if (!isNaN(numHash)) {
      found = pedsData.find((p) => p.Hash === numHash || p.SignedHash === numHash);
    }
  }

  if (!found) {
    return { success: false, error: `Ped not found: ${nameOrHash}` };
  }

  // Return full details (but trim Bones to summary)
  const boneCount = (found.Bones && found.Bones.length) || 0;
  const boneNames = (found.Bones || []).slice(0, 20).map((b) => b.BoneName);

  return {
    success: true,
    ped: {
      name: found.Name,
      hash: found.Hash,
      signedHash: found.SignedHash,
      hexHash: found.HexHash,
      dlc: found.DlcName,
      pedtype: found.Pedtype,
      translatedName: found.TranslatedDirectorName ? {
        english: found.TranslatedDirectorName.English || null,
        label: found.TranslatedDirectorName.Name || null,
      } : null,
      personality: found.Personality || null,
      relationshipGroup: found.RelationshipGroup || null,
      combatInfo: found.CombatInfo || null,
      defaultUnarmedWeapon: found.DefaultUnarmedWeapon || null,
      defaultBrawlingStyle: found.DefaultBrawlingStyle || null,
      movementClipSet: found.MovementClipSet || null,
      clipDictionaryName: found.ClipDictionaryName || null,
      abilityType: found.AbilityType || null,
      isHeadBlendPed: found.IsHeadBlendPed || false,
      canSpawnInCar: found.CanSpawnInCar || false,
      pedVoiceGroup: found.PedVoiceGroup || null,
      boneCount,
      boneSample: boneNames,
    },
  };
}

/** Search peds by name, hash, type or keyword */
function searchPeds(query, opts = {}) {
  if (!query || typeof query !== 'string') {
    return { success: false, error: 'query is required' };
  }

  const limit = Math.min(Math.max(parseInt(opts.limit) || 25, 1), 100);
  const typeFilter = opts.pedtype ? opts.pedtype.toLowerCase() : null;
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
    if (typeFilter && entry.pedtype.toLowerCase() !== typeFilter) continue;
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
        score = 50; // translated name match (e.g. "Boar")
      } else if (entry.personality.includes(lower) || entry.relationshipGroup.includes(lower)) {
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
    pedtype: s.pedtype,
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

/** Check if peds are loaded */
function isLoaded() {
  return loaded;
}

/** Get loading status */
function getStatus() {
  return {
    loaded,
    totalPeds: totalCount,
    pedtypeCount: Object.keys(pedtypeStats).length,
    dlcCount: Object.keys(dlcStats).length,
    cacheFile: CACHE_FILE,
    cacheExists: fs.existsSync(CACHE_FILE),
  };
}

module.exports = {
  loadPeds,
  refreshPeds,
  getOverview,
  getPedsByType,
  getPedsByDlc,
  getPedByName,
  searchPeds,
  isLoaded,
  getStatus,
};
