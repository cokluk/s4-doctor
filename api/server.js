const express = require('express');
const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.S4_DOCTOR_PORT || '4789', 10);
const EXECUTE_TIMEOUT_MS = parseInt(process.env.S4_DOCTOR_TIMEOUT || '15000', 10);
const MAX_LOGS = parseInt(process.env.S4_DOCTOR_LOG_BUFFER || '1000', 10);
const STALE_MS = 5000;

const app = express();
app.set('trust proxy', false);
app.use(express.json({ limit: '1mb' }));

const state = {
  serverLogs: [],
  clientLogs: [],
  seq: 0,
  pending: [],
  resultWaiters: new Map(),
  doctors: { server: [], client: [] },
  players: [],
  fivem: {
    connected: false,
    lastPoll: null,
    lastRegister: null,
    resource: null,
    version: null,
  },
};

function randomId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function isLocalhost(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1')
  );
}

function localhostOnly(req, res, next) {
  if (!isLocalhost(req)) {
    return res.status(403).json({ success: false, error: 'localhost only' });
  }
  next();
}

function normalizeLog(entry) {
  const source = entry.source || entry.side || 'server';
  return {
    id: entry.id,
    seq: entry.seq,
    source,
    side: entry.side || source,
    level: entry.level || 'info',
    message: String(entry.message || ''),
    resource: entry.resource || null,
    channel: entry.channel || null,
    playerId: entry.playerId ?? null,
    playerName: entry.playerName ?? null,
    timestamp: entry.timestamp || Date.now(),
  };
}

function pushLog(entry) {
  const normalized = normalizeLog(entry);
  normalized.seq = ++state.seq;
  normalized.id = normalized.seq;
  const buf = normalized.source === 'client' ? state.clientLogs : state.serverLogs;
  buf.push(normalized);
  while (buf.length > MAX_LOGS) buf.shift();
  return normalized;
}

function pushLogsBatch(logs) {
  if (!Array.isArray(logs)) return [];
  return logs.map((e) => pushLog(e));
}

function matchesFilters(entry, opts) {
  const since = Number(opts.since) || 0;
  if (entry.timestamp < since) return false;

  if (opts.sinceSeq) {
    const sinceSeq = Number(opts.sinceSeq) || 0;
    if ((entry.seq || 0) <= sinceSeq) return false;
  }

  if (opts.level && opts.level !== '' && entry.level !== opts.level) return false;

  const playerId = opts.playerId != null ? Number(opts.playerId) : null;
  if (playerId != null && entry.playerId !== playerId) return false;

  return true;
}

function filterLogs(buf, opts = {}) {
  const out = buf.filter((e) => matchesFilters(e, opts));
  out.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const limit = Math.min(Number(opts.limit) || 100, 500);
  if (out.length > limit) return out.slice(out.length - limit);
  return out;
}

function buildLogsResponse(opts = {}) {
  const source = opts.source || 'all';
  const response = {
    success: true,
    meta: {
      bufferSize: MAX_LOGS,
      latestSeq: state.seq,
    },
  };

  if (source === 'all') {
    response.server = { count: 0, logs: filterLogs(state.serverLogs, opts) };
    response.client = { count: 0, logs: filterLogs(state.clientLogs, opts) };
    response.server.count = response.server.logs.length;
    response.client.count = response.client.logs.length;
  } else if (source === 'server') {
    const logs = filterLogs(state.serverLogs, opts);
    response.server = { count: logs.length, logs };
  } else if (source === 'client') {
    const logs = filterLogs(state.clientLogs, opts);
    response.client = { count: logs.length, logs };
  }

  return response;
}

function getLogsSince(sinceSeq, limit = 50) {
  const combined = [...state.serverLogs, ...state.clientLogs];
  const filtered = combined
    .filter((e) => (e.seq || 0) > sinceSeq)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  if (filtered.length > limit) return filtered.slice(filtered.length - limit);
  return filtered;
}

function clearLogs(source = 'all') {
  if (source === 'server' || source === 'all') state.serverLogs = [];
  if (source === 'client' || source === 'all') state.clientLogs = [];
}

function updateFivemConnection() {
  const now = Date.now();
  state.fivem.connected =
    state.fivem.lastPoll != null && now - state.fivem.lastPoll < STALE_MS;
}

function waitForResult(requestId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      state.resultWaiters.delete(requestId);
      resolve({ success: false, error: 'timeout', requestId });
    }, EXECUTE_TIMEOUT_MS);

    state.resultWaiters.set(requestId, {
      resolve: (result) => {
        clearTimeout(timeout);
        state.resultWaiters.delete(requestId);
        resolve(result);
      },
      timeout,
    });
  });
}

function resolveResult(requestId, result) {
  const waiter = state.resultWaiters.get(requestId);
  if (waiter) waiter.resolve(result);
}

app.get('/health', (_req, res) => {
  updateFivemConnection();
  res.json({
    ok: true,
    service: 's4-doctor-api',
    version: '2.1.0',
    port: PORT,
    logBufferSize: MAX_LOGS,
    serverLogs: state.serverLogs.length,
    clientLogs: state.clientLogs.length,
    fivemConnected: state.fivem.connected,
  });
});

app.get('/status', (_req, res) => {
  updateFivemConnection();
  res.json({
    success: true,
    fivem: {
      connected: state.fivem.connected,
      lastPoll: state.fivem.lastPoll,
      lastRegister: state.fivem.lastRegister,
      resource: state.fivem.resource,
      version: state.fivem.version,
    },
    pendingCount: state.pending.length,
    logCounts: {
      server: state.serverLogs.length,
      client: state.clientLogs.length,
      latestSeq: state.seq,
    },
  });
});

app.get('/logs', (req, res) => {
  res.json(buildLogsResponse({
    source: 'all',
    since: req.query.since,
    sinceSeq: req.query.sinceSeq,
    limit: req.query.limit,
    level: req.query.level,
    playerId: req.query.playerId,
  }));
});

app.get('/logs/server', (req, res) => {
  res.json(buildLogsResponse({
    source: 'server',
    since: req.query.since,
    sinceSeq: req.query.sinceSeq,
    limit: req.query.limit,
    level: req.query.level,
  }));
});

app.get('/logs/client', (req, res) => {
  res.json(buildLogsResponse({
    source: 'client',
    since: req.query.since,
    sinceSeq: req.query.sinceSeq,
    limit: req.query.limit,
    level: req.query.level,
    playerId: req.query.playerId,
  }));
});

app.delete('/logs', (req, res) => {
  const source = req.query.source || req.body?.source || 'all';
  clearLogs(source);
  res.json({ success: true, cleared: source });
});

app.get('/doctors', (_req, res) => {
  res.json({ success: true, ...state.doctors });
});

app.get('/players', (_req, res) => {
  updateFivemConnection();
  res.json({
    success: true,
    count: state.players.length,
    players: state.players,
    fivemConnected: state.fivem.connected,
  });
});

app.post('/execute', async (req, res) => {
  const body = req.body || {};

  if (typeof body.command === 'string' && body.command !== '' && !body.executionType) {
    const requestId = body.requestId || randomId('req');
    const sinceSeq = state.seq;
    state.pending.push({
      requestId,
      command: { type: 'console', command: body.command, requestId },
      createdAt: Date.now(),
    });
    const result = await waitForResult(requestId);
    return res.json({ ...result, logsSince: getLogsSince(sinceSeq) });
  }

  const requestId = body.requestId || randomId('req');
  const sinceSeq = state.seq;
  const command = { ...body, requestId };
  delete command.securityToken;

  state.pending.push({ requestId, command, createdAt: Date.now() });
  const result = await waitForResult(requestId);

  res.json({
    ...result,
    requestId: result.requestId || requestId,
    logsSince: getLogsSince(sinceSeq),
  });
});

app.post('/internal/register', localhostOnly, (req, res) => {
  const body = req.body || {};
  state.fivem.lastRegister = Date.now();
  state.fivem.lastPoll = Date.now();
  state.fivem.connected = true;
  state.fivem.resource = body.resource || 's4-doctor';
  state.fivem.version = body.version || null;

  if (body.doctors && typeof body.doctors === 'object') {
    state.doctors.server = Array.isArray(body.doctors.server) ? body.doctors.server : [];
    state.doctors.client = Array.isArray(body.doctors.client) ? body.doctors.client : [];
  }

  res.json({ ok: true, port: PORT });
});

app.post('/internal/doctors', localhostOnly, (req, res) => {
  const body = req.body || {};
  if (body.doctors && typeof body.doctors === 'object') {
    state.doctors.server = Array.isArray(body.doctors.server) ? body.doctors.server : [];
    state.doctors.client = Array.isArray(body.doctors.client) ? body.doctors.client : [];
  }
  res.json({ ok: true });
});

app.post('/internal/players', localhostOnly, (req, res) => {
  state.fivem.lastPoll = Date.now();
  const body = req.body || {};
  state.players = Array.isArray(body.players) ? body.players : [];
  res.json({ ok: true, count: state.players.length });
});

app.post('/internal/logs', localhostOnly, (req, res) => {
  state.fivem.lastPoll = Date.now();
  const logs = req.body?.logs;
  const added = pushLogsBatch(Array.isArray(logs) ? logs : logs ? [logs] : []);
  res.json({ ok: true, added: added.length, latestSeq: state.seq });
});

app.get('/internal/pending', localhostOnly, (req, res) => {
  state.fivem.lastPoll = Date.now();
  state.fivem.connected = true;

  const batch = state.pending.splice(0, 10);
  res.json({
    pending: batch.map((p) => p.command),
  });
});

app.post('/internal/result', localhostOnly, (req, res) => {
  state.fivem.lastPoll = Date.now();
  const { requestId, result } = req.body || {};
  if (requestId) resolveResult(requestId, result || { success: false, error: 'empty result' });
  res.json({ ok: true });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'not_found' });
});

const PID_FILE = path.join(__dirname, '.api.pid');

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch (_) {
  }
}

function removePidFile() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch (_) {
  }
}

process.on('exit', removePidFile);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const server = app.listen(PORT, '127.0.0.1', () => {
  writePidFile();
  console.log(`[s4-doctor-api] http://127.0.0.1:${PORT}`);
  console.log('[s4-doctor-api] Agent: GET /health, GET /logs, POST /execute');
  console.log('[s4-doctor-api] FiveM bridge: /internal/* (localhost only)');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`[s4-doctor-api] Port ${PORT} already in use — existing instance assumed`);
    process.exit(0);
    return;
  }

  console.error('[s4-doctor-api] listen error:', err);
  process.exit(1);
});
