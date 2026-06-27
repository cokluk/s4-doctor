/**
* nativesManager.js — FiveM natives.json loader, cache & search engine
*
* - On first load: downloads from https://runtime.fivem.net/doc/natives.json
* - Caches to api/data/natives.json for subsequent starts
* - Builds in-memory index for fast name / description search
**/

const fs = require('fs');
const path = require('path');
const https = require('https');

const NATIVES_URL = 'https://runtime.fivem.net/doc/natives.json';
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'natives.json');

let nativesData = null;   // raw { NAMESPACE: { hash: {...} } }
let searchIndex = [];     // flat array of { name, hash, ns, lowerName }
let namespaceStats = {};  // { NAMESPACE: count }
let totalCount = 0;
let loaded = false;

// ─── Download ────────────────────────────────────────────────────────────────

function downloadNatives() {
	return new Promise((resolve, reject) => {
		console.log('[s4-doctor-api] Downloading natives.json from runtime.fivem.net...');

		const request = https.get(NATIVES_URL, { timeout: 30000 }, (res) => {
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

					// Ensure data dir exists
					if (!fs.existsSync(DATA_DIR)) {
						fs.mkdirSync(DATA_DIR, { recursive: true });
					}

					fs.writeFileSync(CACHE_FILE, raw, 'utf8');
					console.log('[s4-doctor-api] natives.json cached to api/data/natives.json');
					resolve(parsed);
				} catch (err) {
					reject(err);
				}
			});
			res.on('error', reject);
		});

		request.on('error', reject);
		request.on('timeout', () => {
			request.destroy();
			reject(new Error('Download timeout'));
		});
	});
}

// ─── Build Index ─────────────────────────────────────────────────────────────

function buildIndex(data) {
	searchIndex = [];
	namespaceStats = {};
	totalCount = 0;

	for (const [ns, natives] of Object.entries(data)) {
		if (typeof natives !== 'object' || natives === null) continue;

		let nsCount = 0;
		for (const [hash, info] of Object.entries(natives)) {
			if (typeof info !== 'object' || info === null) continue;

			const name = info.name || hash;
			searchIndex.push({
				name,
				hash: info.hash || hash,
				ns: info.ns || ns,
				lowerName: name.toLowerCase(),
				lowerDesc: (info.description || '').toLowerCase().slice(0, 500),
				params: info.params || [],
				results: info.results || 'void',
			});
			nsCount++;
			totalCount++;
		}
		namespaceStats[ns] = nsCount;
	}

	searchIndex.sort((a, b) => a.lowerName.localeCompare(b.lowerName));
}

// ─── Load ────────────────────────────────────────────────────────────────────

async function loadNatives() {
	if (loaded && nativesData) return;

	// Try cache first
	try {
		if (fs.existsSync(CACHE_FILE)) {
			const raw = fs.readFileSync(CACHE_FILE, 'utf8');
			nativesData = JSON.parse(raw);
			buildIndex(nativesData);
			loaded = true;
			console.log(`[s4-doctor-api] Loaded ${totalCount} natives from cache (${Object.keys(namespaceStats).length} namespaces)`);
			return;
		}
	} catch (err) {
		console.warn('[s4-doctor-api] Cache read failed, will download:', err.message);
	}

	// Download
	try {
		nativesData = await downloadNatives();
		buildIndex(nativesData);
		loaded = true;
		console.log(`[s4-doctor-api] Loaded ${totalCount} natives from download (${Object.keys(namespaceStats).length} namespaces)`);
	} catch (err) {
		console.error('[s4-doctor-api] Failed to load natives:', err.message);
	}
}

// ─── Refresh (re-download) ──────────────────────────────────────────────────

async function refreshNatives() {
	try {
		nativesData = await downloadNatives();
		buildIndex(nativesData);
		loaded = true;
		return { success: true, totalCount, namespaces: Object.keys(namespaceStats).length };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** List all namespaces with counts */
function getNamespaces() {
	return {
		success: true,
		totalNatives: totalCount,
		namespaces: Object.entries(namespaceStats)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, count]) => ({ name, count })),
	};
}

/** List natives in a namespace */
function getNativesByNamespace(ns) {
	const upper = ns.toUpperCase();
	if (!nativesData || !nativesData[upper]) {
		return { success: false, error: `Namespace not found: ${ns}` };
	}

	const natives = [];
	for (const [hash, info] of Object.entries(nativesData[upper])) {
		if (typeof info !== 'object' || info === null) continue;
		natives.push({
			name: info.name || hash,
			hash: info.hash || hash,
			params: (info.params || []).map((p) => `${p.type} ${p.name}`).join(', '),
			results: info.results || 'void',
		});
	}

	natives.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

	return {
		success: true,
		namespace: upper,
		count: natives.length,
		natives,
	};
}

/** Get a single native's full details */
function getNativeByHash(ns, hash) {
	const upper = ns.toUpperCase();
	if (!nativesData || !nativesData[upper]) {
		return { success: false, error: `Namespace not found: ${ns}` };
	}

	// Normalize hash — accept with/without 0x prefix
	let normalizedHash = hash.toUpperCase();
	if (!normalizedHash.startsWith('0X')) {
		normalizedHash = '0X' + normalizedHash;
	}
	// Format back: 0x prefix
	normalizedHash = '0x' + normalizedHash.slice(2);

	const info = nativesData[upper][normalizedHash];
	if (!info) {
		return { success: false, error: `Native not found: ${ns}/${hash}` };
	}

	return {
		success: true,
		native: {
			name: info.name || normalizedHash,
			hash: info.hash || normalizedHash,
			ns: info.ns || upper,
			jhash: info.jhash || null,
			params: info.params || [],
			results: info.results || 'void',
			resultsDescription: info.resultsDescription || null,
			description: info.description || '',
			examples: info.examples || [],
			aliases: info.aliases || [],
		},
	};
}

/** Search natives by name, hash or description */
function searchNatives(query, opts = {}) {
	if (!query || typeof query !== 'string') {
		return { success: false, error: 'query is required' };
	}

	const limit = Math.min(Math.max(parseInt(opts.limit) || 25, 1), 100);
	const nsFilter = opts.namespace ? opts.namespace.toUpperCase() : null;
	const lower = query.toLowerCase();
	const isHash = query.startsWith('0x') || query.startsWith('0X');

	// Convert camelCase/PascalCase to snake_case for matching
	// e.g. "CreateVehicle" → "create_vehicle", "SetEntityCoords" → "set_entity_coords"
	const snakeLower = query
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase();

	const scored = [];

	for (const entry of searchIndex) {
		if (nsFilter && entry.ns !== nsFilter) continue;

		let score = 0;

		if (isHash) {
			// Hash search — exact prefix match
			if (entry.hash.toLowerCase().startsWith(lower)) {
				score = 100;
			} else {
				continue;
			}
		} else {
			// Name search — try both original and snake_case conversion
			if (entry.lowerName === lower || entry.lowerName === snakeLower) {
				score = 100; // exact match
			} else if (entry.lowerName.startsWith(lower) || entry.lowerName.startsWith(snakeLower)) {
				score = 80;  // prefix match
			} else if (entry.lowerName.includes(lower) || entry.lowerName.includes(snakeLower)) {
				score = 60;  // contains
			} else if (entry.lowerDesc.includes(lower)) {
				score = 30;  // description match
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
		ns: s.ns,
		params: s.params.map((p) => `${p.type} ${p.name}`).join(', '),
		results: s.results,
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

/** Check if natives are loaded */
function isLoaded() {
	return loaded;
}

/** Get loading status */
function getStatus() {
	return {
		loaded,
		totalNatives: totalCount,
		namespaceCount: Object.keys(namespaceStats).length,
		cacheFile: CACHE_FILE,
		cacheExists: fs.existsSync(CACHE_FILE),
	};
}

module.exports = {
	loadNatives,
	refreshNatives,
	getNamespaces,
	getNativesByNamespace,
	getNativeByHash,
	searchNatives,
	isLoaded,
	getStatus,
};
