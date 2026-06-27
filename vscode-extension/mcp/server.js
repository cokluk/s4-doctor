#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const BASE_URL = (process.env.S4_DOCTOR_URL || 'http://127.0.0.1:4789').replace(/\/$/, '');

async function api(method, path, body) {
	const opts = { method, headers: { 'Content-Type': 'application/json' } };
	if (body !== undefined) opts.body = JSON.stringify(body);
	const res = await fetch(`${BASE_URL}${path}`, opts);
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return { error: text, status: res.status };
	}
}

const server = new Server(
	{ name: 's4-doctor', version: '1.0.0' },
	{ capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: 's4_doctor_health',
			description: 'Check s4-doctor API and FiveM connection status (GET /health)',
			inputSchema: { type: 'object', properties: {} },
		},
		{
			name: 's4_doctor_logs',
			description: 'Fetch server/client logs (GET /logs). Use sinceSeq for incremental reads.',
			inputSchema: {
				type: 'object',
				properties: {
					sinceSeq: { type: 'number', description: 'Return logs after this sequence number' },
					limit: { type: 'number', description: 'Max entries (default 50)' },
				},
			},
		},
		{
			name: 's4_doctor_execute',
			description: 'Execute export/event/callback/console via POST /execute',
			inputSchema: {
				type: 'object',
				properties: {
					command: { type: 'object', description: 'Execute payload (JSON object)' },
				},
				required: ['command'],
			},
		},
		{
			name: 's4_doctor_doctors',
			description: 'List registered doctor.lua scripts (GET /doctors)',
			inputSchema: { type: 'object', properties: {} },
		},
		{
			name: 's4_doctor_clear_logs',
			description: 'Clear log buffer (DELETE /logs)',
			inputSchema: {
				type: 'object',
				properties: {
					source: { type: 'string', enum: ['all', 'server', 'client'], description: 'Default: all' },
				},
			},
		},
		{
			name: 's4_doctor_natives_search',
			description: 'Search FiveM native functions by name, hash or description. Returns matching natives with parameters and return types. Example: query "SetEntityCoords" or "0x06843DA7060A026B".',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Native name, hash (0x...) or keyword to search' },
					namespace: { type: 'string', description: 'Filter by namespace (e.g. ENTITY, VEHICLE, PED, PLAYER)' },
					limit: { type: 'number', description: 'Max results (default 25, max 100)' },
				},
				required: ['query'],
			},
		},
		{
			name: 's4_doctor_natives_info',
			description: 'Get full details of a specific FiveM native function including parameters, return type, description and examples. Requires namespace and hash.',
			inputSchema: {
				type: 'object',
				properties: {
					namespace: { type: 'string', description: 'Namespace (e.g. ENTITY, VEHICLE, PED)' },
					hash: { type: 'string', description: 'Native hash (e.g. 0x06843DA7060A026B)' },
				},
				required: ['namespace', 'hash'],
			},
		},
		{
			name: 's4_doctor_natives_list',
			description: 'List all FiveM native namespaces with counts, or list all natives in a specific namespace.',
			inputSchema: {
				type: 'object',
				properties: {
					namespace: { type: 'string', description: 'If provided, list natives in this namespace. Otherwise list all namespaces.' },
				},
			},
		},
		{
			name: 's4_doctor_peds_search',
			description: 'Search FiveM peds by name, hash, type or DLC. Example: query "boar" or "0xCE5FF074".',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Ped name, hash (0x...) or keyword to search' },
					pedtype: { type: 'string', description: 'Filter by pedtype (e.g. Animal, Civmale, Cop)' },
					dlc: { type: 'string', description: 'Filter by DLC (e.g. basegame, mpHeist)' },
					limit: { type: 'number', description: 'Max results (default 25, max 100)' },
				},
				required: ['query'],
			},
		},
		{
			name: 's4_doctor_peds_info',
			description: 'Get full details of a specific FiveM ped including hash, pedtype, and bone information.',
			inputSchema: {
				type: 'object',
				properties: {
					nameOrHash: { type: 'string', description: 'Ped name (e.g. a_c_boar) or hash (e.g. 0xCE5FF074)' },
				},
				required: ['nameOrHash'],
			},
		},
		{
			name: 's4_doctor_peds_list',
			description: 'List all peds in a specific category (type or dlc), or get overview stats.',
			inputSchema: {
				type: 'object',
				properties: {
					categoryType: { type: 'string', enum: ['type', 'dlc', 'overview'], description: 'What to list' },
					categoryValue: { type: 'string', description: 'The type (e.g. Animal) or dlc (e.g. basegame) to list' },
				},
				required: ['categoryType'],
			},
		},
		{
			name: 's4_doctor_weapons_search',
			description: 'Search FiveM weapons by name, hash, category or DLC. Example: query "pistol" or "0x1B06D571".',
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Weapon name, hash (0x...) or keyword to search' },
					category: { type: 'string', description: 'Filter by category (e.g. GROUP_PISTOL, GROUP_MELEE)' },
					dlc: { type: 'string', description: 'Filter by DLC (e.g. basegame, mpHeist)' },
					limit: { type: 'number', description: 'Max results (default 25, max 100)' },
				},
				required: ['query'],
			},
		},
		{
			name: 's4_doctor_weapons_info',
			description: 'Get full details of a specific FiveM weapon including hash, category, ammo type, and components.',
			inputSchema: {
				type: 'object',
				properties: {
					nameOrHash: { type: 'string', description: 'Weapon name (e.g. WEAPON_PISTOL) or hash (e.g. 0x1B06D571)' },
				},
				required: ['nameOrHash'],
			},
		},
		{
			name: 's4_doctor_weapons_list',
			description: 'List all weapons in a specific category, or get overview stats.',
			inputSchema: {
				type: 'object',
				properties: {
					listType: { type: 'string', enum: ['category', 'overview'], description: 'What to list' },
					category: { type: 'string', description: 'The category (e.g. GROUP_RIFLE) to list' },
				},
				required: ['listType'],
			},
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;
	let result;

	try {
		switch (name) {
			case 's4_doctor_health':
				result = await api('GET', '/health');
				break;
			case 's4_doctor_logs': {
				const params = new URLSearchParams();
				if (args?.sinceSeq != null) params.set('sinceSeq', String(args.sinceSeq));
				params.set('limit', String(args?.limit ?? 50));
				result = await api('GET', `/logs?${params}`);
				break;
			}
			case 's4_doctor_execute':
				result = await api('POST', '/execute', args.command);
				break;
			case 's4_doctor_doctors':
				result = await api('GET', '/doctors');
				break;
			case 's4_doctor_clear_logs':
				result = await api('DELETE', `/logs?source=${encodeURIComponent(args?.source || 'all')}`);
				break;

			// ─── Natives tools ─────────────────────────────────────────────
			case 's4_doctor_natives_search': {
				const params = new URLSearchParams();
				params.set('q', args.query);
				if (args?.namespace) params.set('namespace', args.namespace);
				if (args?.limit != null) params.set('limit', String(args.limit));
				result = await api('GET', `/natives/search?${params}`);
				break;
			}
			case 's4_doctor_natives_info': {
				const ns = encodeURIComponent(args.namespace);
				const hash = encodeURIComponent(args.hash);
				result = await api('GET', `/natives/${ns}/${hash}`);
				break;
			}
			case 's4_doctor_natives_list': {
				if (args?.namespace) {
					const ns = encodeURIComponent(args.namespace);
					result = await api('GET', `/natives/${ns}`);
				} else {
					result = await api('GET', '/natives');
				}
				break;
			}

			// ─── Peds tools ──────────────────────────────────────────────
			case 's4_doctor_peds_search': {
				const params = new URLSearchParams();
				params.set('q', args.query);
				if (args?.pedtype) params.set('type', args.pedtype);
				if (args?.dlc) params.set('dlc', args.dlc);
				if (args?.limit != null) params.set('limit', String(args.limit));
				result = await api('GET', `/peds/search?${params}`);
				break;
			}
			case 's4_doctor_peds_info': {
				const nameOrHash = encodeURIComponent(args.nameOrHash);
				result = await api('GET', `/peds/info/${nameOrHash}`);
				break;
			}
			case 's4_doctor_peds_list': {
				if (args.categoryType === 'type' && args.categoryValue) {
					result = await api('GET', `/peds/type/${encodeURIComponent(args.categoryValue)}`);
				} else if (args.categoryType === 'dlc' && args.categoryValue) {
					result = await api('GET', `/peds/dlc/${encodeURIComponent(args.categoryValue)}`);
				} else {
					result = await api('GET', '/peds');
				}
				break;
			}

			// ─── Weapons tools ───────────────────────────────────────────
			case 's4_doctor_weapons_search': {
				const params = new URLSearchParams();
				params.set('q', args.query);
				if (args?.category) params.set('category', args.category);
				if (args?.dlc) params.set('dlc', args.dlc);
				if (args?.limit != null) params.set('limit', String(args.limit));
				result = await api('GET', `/weapons/search?${params}`);
				break;
			}
			case 's4_doctor_weapons_info': {
				const nameOrHash = encodeURIComponent(args.nameOrHash);
				result = await api('GET', `/weapons/info/${nameOrHash}`);
				break;
			}
			case 's4_doctor_weapons_list': {
				if (args.listType === 'category' && args.category) {
					result = await api('GET', `/weapons/category/${encodeURIComponent(args.category)}`);
				} else {
					result = await api('GET', '/weapons');
				}
				break;
			}

			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	} catch (err) {
		result = { error: err.message };
	}

	return {
		content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
	};
});

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
