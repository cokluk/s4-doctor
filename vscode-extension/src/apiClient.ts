import * as vscode from 'vscode';

export interface HealthResponse {
	ok: boolean;
	service: string;
	version: string;
	port: number;
	logBufferSize: number;
	serverLogs: number;
	clientLogs: number;
	fivemConnected: boolean;
}

export interface StatusResponse {
	success: boolean;
	fivem: {
		connected: boolean;
		lastPoll: number | null;
		lastRegister: number | null;
		resource: string | null;
		version: string | null;
	};
	pendingCount: number;
	logCounts: {
		server: number;
		client: number;
		latestSeq: number;
	};
}

export interface LogEntry {
	id: number;
	seq: number;
	source: string;
	side: string;
	level: string;
	message: string;
	resource: string | null;
	channel: string | null;
	playerId: number | null;
	playerName: string | null;
	timestamp: number;
}

export interface LogsResponse {
	server?: { logs: LogEntry[] };
	client?: { logs: LogEntry[] };
	meta?: {
		latestSeq: number;
		count: number;
	};
}

export interface DoctorsResponse {
	success: boolean;
	server: Array<{ resource: string; side: string; functions?: string[] }>;
	client: Array<{ resource: string; side: string; functions?: string[] }>;
}

export interface ExecuteResult {
	success?: boolean;
	error?: string;
	requestId?: string;
	data?: unknown;
	logsSince?: LogEntry[];
}

export interface NativeSearchEntry {
	name: string;
	hash: string;
	ns: string;
	params: string;
	results: string;
	score: number;
}

export interface NativeSearchResult {
	success: boolean;
	query: string;
	count: number;
	totalMatches: number;
	results: NativeSearchEntry[];
	error?: string;
}

export interface NativeInfoResult {
	success: boolean;
	native?: {
		name: string;
		hash: string;
		ns: string;
		jhash: string | null;
		params: Array<{ name: string; type: string; description?: string }>;
		results: string;
		resultsDescription: string | null;
		description: string;
		examples: Array<{ lang: string; code: string }>;
		aliases: string[];
	};
	error?: string;
}

export interface PedSearchEntry {
	name: string;
	hash: number;
	hexHash: string;
	pedtype: string;
	dlc: string;
	score: number;
}

export interface PedSearchResult {
	success: boolean;
	query: string;
	count: number;
	totalMatches: number;
	results: PedSearchEntry[];
	error?: string;
}

export interface PedInfoResult {
	success: boolean;
	ped?: {
		name: string;
		hash: number;
		signedHash: number;
		hexHash: string;
		dlc: string;
		pedtype: string;
		translatedName: { english: string | null; label: string | null } | null;
		personality: string | null;
		relationshipGroup: string | null;
		combatInfo: string | null;
		defaultUnarmedWeapon: string | null;
		defaultBrawlingStyle: string | null;
		movementClipSet: string | null;
		clipDictionaryName: string | null;
		abilityType: string | null;
		isHeadBlendPed: boolean;
		canSpawnInCar: boolean;
		pedVoiceGroup: string | null;
		boneCount: number;
		boneSample: string[];
	};
	error?: string;
}

export interface WeaponSearchEntry {
	name: string;
	hash: number;
	hexHash: string;
	category: string;
	dlc: string;
	score: number;
}

export interface WeaponSearchResult {
	success: boolean;
	query: string;
	count: number;
	totalMatches: number;
	results: WeaponSearchEntry[];
	error?: string;
}

export interface WeaponInfoResult {
	success: boolean;
	weapon?: {
		name: string;
		hash: number;
		signedHash: number;
		hexHash: string;
		dlc: string;
		category: string;
		translatedName: { english: string | null; label: string | null } | null;
		modelName: string | null;
		ammoType: string | null;
		ammoModelName: string | null;
		damageType: string | null;
		isVehicleWeapon: boolean;
		flags: string[];
		components: string[];
		tints: string[];
	};
	error?: string;
}

export class S4DoctorClient {
	constructor(private getBaseUrl: () => string) { }

	get baseUrl(): string {
		return this.getBaseUrl();
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const url = `${this.getBaseUrl()}${path}`;
		const opts: RequestInit = {
			method,
			headers: { 'Content-Type': 'application/json' },
		};
		if (body !== undefined) {
			opts.body = JSON.stringify(body);
		}

		let res: Response;
		try {
			res = await fetch(url, opts);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`Cannot reach s4-doctor API at ${url}: ${msg}`);
		}

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`HTTP ${res.status}: ${text}`);
		}

		return res.json() as Promise<T>;
	}

	health(): Promise<HealthResponse> {
		return this.request<HealthResponse>('GET', '/health');
	}

	status(): Promise<StatusResponse> {
		return this.request<StatusResponse>('GET', '/status');
	}

	fetchLogs(opts: {
		since?: number;
		sinceSeq?: number;
		limit?: number;
		endpoint?: string;
	} = {}): Promise<LogsResponse> {
		const params = new URLSearchParams();
		if (opts.since !== undefined) params.set('since', String(opts.since));
		if (opts.sinceSeq !== undefined) params.set('sinceSeq', String(opts.sinceSeq));
		if (opts.limit !== undefined) params.set('limit', String(opts.limit));

		const endpoint = opts.endpoint || '/logs';
		const qs = params.toString();
		return this.request<LogsResponse>('GET', qs ? `${endpoint}?${qs}` : endpoint);
	}

	listDoctors(): Promise<DoctorsResponse> {
		return this.request<DoctorsResponse>('GET', '/doctors');
	}

	execute(body: Record<string, unknown>): Promise<ExecuteResult> {
		return this.request<ExecuteResult>('POST', '/execute', body);
	}

	clearLogs(source: 'all' | 'server' | 'client' = 'all'): Promise<{ success: boolean; cleared: string }> {
		return this.request('DELETE', `/logs?source=${encodeURIComponent(source)}`);
	}

	searchNatives(query: string, opts: { limit?: number; namespace?: string } = {}): Promise<NativeSearchResult> {
		const params = new URLSearchParams();
		params.set('q', query);
		if (opts.limit !== undefined) { params.set('limit', String(opts.limit)); }
		if (opts.namespace) { params.set('namespace', opts.namespace); }
		return this.request<NativeSearchResult>('GET', `/natives/search?${params}`);
	}

	getNativeInfo(namespace: string, hash: string): Promise<NativeInfoResult> {
		return this.request<NativeInfoResult>('GET', `/natives/${encodeURIComponent(namespace)}/${encodeURIComponent(hash)}`);
	}

	searchPeds(query: string, opts: { limit?: number; type?: string; dlc?: string } = {}): Promise<PedSearchResult> {
		const params = new URLSearchParams();
		params.set('q', query);
		if (opts.limit !== undefined) { params.set('limit', String(opts.limit)); }
		if (opts.type) { params.set('type', opts.type); }
		if (opts.dlc) { params.set('dlc', opts.dlc); }
		return this.request<PedSearchResult>('GET', `/peds/search?${params}`);
	}

	getPedInfo(nameOrHash: string): Promise<PedInfoResult> {
		return this.request<PedInfoResult>('GET', `/peds/info/${encodeURIComponent(nameOrHash)}`);
	}

	searchWeapons(query: string, opts: { limit?: number; category?: string; dlc?: string } = {}): Promise<WeaponSearchResult> {
		const params = new URLSearchParams();
		params.set('q', query);
		if (opts.limit !== undefined) { params.set('limit', String(opts.limit)); }
		if (opts.category) { params.set('category', opts.category); }
		if (opts.dlc) { params.set('dlc', opts.dlc); }
		return this.request<WeaponSearchResult>('GET', `/weapons/search?${params}`);
	}

	getWeaponInfo(nameOrHash: string): Promise<WeaponInfoResult> {
		return this.request<WeaponInfoResult>('GET', `/weapons/info/${encodeURIComponent(nameOrHash)}`);
	}
}

export function formatLogEntry(entry: LogEntry): string {
	const tag =
		entry.side === 'client' ? `[client:${entry.playerId ?? '?'}${entry.playerName ? ` ${entry.playerName}` : ''}]` : '[server]';
	const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
	return `${ts} ${tag} [${entry.level}] #${entry.seq} ${entry.message}`;
}

export function getApiUrl(): string {
	const cfg = vscode.workspace.getConfiguration('s4-doctor');
	return (cfg.get<string>('apiUrl') || 'http://127.0.0.1:4789').replace(/\/$/, '');
}
