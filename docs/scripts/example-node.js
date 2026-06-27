const BASE_URL = process.env.S4_DOCTOR_URL || 'http://127.0.0.1:4789';

let lastSince = 0;
let lastSinceSeq = 0;

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res.json();
}

async function health() {
  return request('GET', '/health');
}

async function status() {
  return request('GET', '/status');
}

async function fetchLogs({ endpoint = '/logs', limit = 100, playerId, level } = {}) {
  const params = new URLSearchParams({
    since: String(lastSince),
    sinceSeq: String(lastSinceSeq),
    limit: String(limit),
  });
  if (playerId) params.set('playerId', String(playerId));
  if (level) params.set('level', level);

  const data = await request('GET', `${endpoint}?${params}`);

  const batches = [];
  if (data.server?.logs) batches.push(...data.server.logs);
  if (data.client?.logs) batches.push(...data.client.logs);

  for (const entry of batches) {
    const tag = entry.side === 'client'
      ? `[client:${entry.playerId}${entry.playerName ? ` ${entry.playerName}` : ''}]`
      : '[server]';
    console.log(`${tag} [${entry.level}] #${entry.seq} ${entry.message}`);
    if (entry.timestamp > lastSince) lastSince = entry.timestamp;
    if (entry.seq > lastSinceSeq) lastSinceSeq = entry.seq;
  }

  return data;
}

async function fetchServerLogs(opts = {}) {
  return fetchLogs({ ...opts, endpoint: '/logs/server' });
}

async function fetchClientLogs(playerId, opts = {}) {
  return fetchLogs({ ...opts, endpoint: '/logs/client', playerId });
}

async function pollLogs(intervalMs = 1000) {
  console.log(`Log polling started (${intervalMs}ms)...`);
  setInterval(() => fetchLogs().catch(console.error), intervalMs);
}

async function listDoctors() {
  return request('GET', '/doctors');
}

async function execute(command) {
  return request('POST', '/execute', command);
}

async function runConsoleCommand(command) {
  return request('POST', '/execute', { command });
}

async function clearLogs(source = 'all') {
  return request('DELETE', `/logs?source=${encodeURIComponent(source)}`);
}

async function executeAndVerify(command, { logLimit = 50 } = {}) {
  const before = await fetchLogs({ limit: 1 });
  const sinceSeq = before.meta?.latestSeq || lastSinceSeq;

  const result = await execute(command);
  console.log('Execute:', JSON.stringify(result, null, 2));

  const logs = await fetchLogs({ sinceSeq, limit: logLimit });
  const hasError = (logs.server?.logs || [])
    .concat(logs.client?.logs || [])
    .some((e) => e.level === 'error');

  return {
    ok: result.success === true && !hasError,
    result,
    logs,
  };
}

async function main() {
  console.log(await health());
  console.log(await status());
  console.log(await listDoctors());

  const result = await execute({
    targetResource: 'ox_inventory',
    executionType: 'export',
    frameworkType: 'ox',
    targetName: 'Items',
    arguments: [],
    side: 'server',
  });
  console.log('Execute:', JSON.stringify(result, null, 2));

  await fetchServerLogs({ limit: 20 });
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  health,
  status,
  fetchLogs,
  fetchServerLogs,
  fetchClientLogs,
  pollLogs,
  listDoctors,
  execute,
  runConsoleCommand,
  clearLogs,
  executeAndVerify,
};
