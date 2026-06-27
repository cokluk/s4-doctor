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

export class S4DoctorClient {
  constructor(private getBaseUrl: () => string) {}

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
}

export function formatLogEntry(entry: LogEntry): string {
  const tag =
    entry.side === 'client'
      ? `[client:${entry.playerId ?? '?'}${entry.playerName ? ` ${entry.playerName}` : ''}]`
      : '[server]';
  const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
  return `${ts} ${tag} [${entry.level}] #${entry.seq} ${entry.message}`;
}

export function getApiUrl(): string {
  const cfg = vscode.workspace.getConfiguration('s4-doctor');
  return (cfg.get<string>('apiUrl') || 'http://127.0.0.1:4789').replace(/\/$/, '');
}
