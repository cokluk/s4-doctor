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
