# s4-doctor — AI Agent Integration Guide

This guide helps AI coding agents (Cursor, Claude, GitHub Copilot, Gemini, etc.) use the s4-doctor FiveM debug API during script development.

## API Base URL

```
http://127.0.0.1:4789
```

No authentication. Localhost only.

Configure via FiveM convar `s4_doctor_bridge` or VS Code setting `s4-doctor.apiUrl`.

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Service + FiveM connection status |
| GET | `/status` | Detailed connection info |
| GET | `/logs` | Server + client logs (supports `since`, `sinceSeq`, `limit`) |
| GET | `/logs/server` | Server logs only |
| GET | `/logs/client` | Client logs only |
| POST | `/execute` | Trigger export/event/callback/console command |
| GET | `/doctors` | List registered doctor.lua scripts |
| DELETE | `/logs?source=all\|server\|client` | Clear log buffer |

---

## Agent Workflow

```
1. GET /health          → verify fivemConnected
2. Make code changes
3. POST /execute        → run test
4. GET /logs?sinceSeq=N → verify output, check for errors
5. Fix and repeat
```

### Execute — export test

```json
POST /execute
{
  "targetResource": "ox_inventory",
  "executionType": "export",
  "frameworkType": "ox",
  "targetName": "Items",
  "arguments": [],
  "side": "server"
}
```

### Execute — console command

```json
POST /execute
{ "command": "ensure my-resource" }
```

### Log polling

```
GET /logs?sinceSeq=42&limit=50
```

Response includes `server.logs[]`, `client.logs[]`, and `meta.latestSeq`.

---

## Cursor Rules

Copy the rule file to your workspace:

```bash
cp vscode-extension/.cursor/rules/s4-doctor.mdc .cursor/rules/
```

Or symlink it. Cursor will auto-apply when editing `.lua`, `.js`, `.ts` files.

---

## VS Code / Cursor Extension

Install from `vscode-extension/` folder:

1. Open the folder in VS Code/Cursor
2. Run `npm install && npm run compile`
3. Press F5 to launch Extension Development Host, **or**
4. Run `Developer: Install Extension from Location` and select `vscode-extension/`

Features:
- Status bar connection indicator
- Live log output channel
- Doctor Check panel (Flutter doctor style)
- Command palette commands for health, execute, clear logs

---

## MCP Server (Cursor)

A minimal MCP server is included in `mcp/`. Add to Cursor MCP settings:

```json
{
  "mcpServers": {
    "s4-doctor": {
      "command": "node",
      "args": ["E:/path/to/s4-doctor/vscode-extension/mcp/server.js"],
      "env": {
        "S4_DOCTOR_URL": "http://127.0.0.1:4789"
      }
    }
  }
}
```

Available MCP tools:
- `s4_doctor_health` — connection check
- `s4_doctor_logs` — fetch recent logs
- `s4_doctor_execute` — run execute command
- `s4_doctor_doctors` — list registered doctors
- `s4_doctor_clear_logs` — clear log buffer

---

## doctor.lua Setup

Add to target resource `fxmanifest.lua`:

```lua
shared_script '@s4-doctor/doctor.lua'
```

Expose functions for testing:

```lua
Doctor.expose('calculatePrice', calculatePrice)
```

---

## Prompt Template (any AI agent)

```
You are developing a FiveM resource. Use s4-doctor API at http://127.0.0.1:4789:

1. Check GET /health — fivemConnected must be true
2. After code changes, POST /execute to test
3. Read GET /logs?sinceSeq=N to verify results
4. For local function tests, ensure target has shared_script '@s4-doctor/doctor.lua'

Never assume code works without checking logs via s4-doctor.
```

---

## Prerequisites

```cfg
# server.cfg
ensure yarn
ensure webpack
ensure s4-doctor
```

FiveM installs Node dependencies and starts the API when the resource loads — no server-side `npm install` required.
