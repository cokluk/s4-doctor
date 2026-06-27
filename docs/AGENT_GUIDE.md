# s4-doctor — AI Agent Guide

You are a **FiveM Debug & Test Agent**. Instead of writing raw Lua, you produce **structured JSON commands**, **watch logs**, and interpret results. The bridge is the **Node.js API** (localhost:4789), the NUI dashboard, or the server console.

---

## Architecture

```
[AI Agent / Cursor]
        │ HTTP
        ▼
[Node.js API :4789]  ← api/server.js
        ▲ │
  push logs │ │ poll execute
        │ ▼
[s4-doctor resource — server.lua + client.lua]
   ├── Log Collector (server console + client F8)
   ├── NUI Dashboard (SendNUIMessage live push)
   ├── Command Executor (export/event/callback/command)
   └── Doctor Registry (manual doctor.lua registrations)
        │
        ├──► [doctor.lua @ target script] (optional)
        └──► [Direct hub execute] (without doctor)
```

FiveM no longer uses **SetHttpHandler (30120)**. All agent communication goes through the Node.js server on a separate port. FiveM connects to Node via `PerformHttpRequest`. On resource start, FXServer installs dependencies via `yarn` and starts the API through `api/launcher.lua` — no manual `npm install` or `npm start`.

---

## Architecture boundary (critical)

**s4-doctor is a generic hub — never a host for target-script logic.**

| Belongs in **s4-doctor** | Belongs in **target script** (e.g. `doctor-test`, your resource) |
|--------------------------|------------------------------------------------------------------|
| Log capture (server + client F8) | Spawn, warp, gameplay, business logic |
| `POST /execute` routing | `Doctor.expose(...)`, exports, events |
| `doctor.lua` inject file (opt-in) | Test handlers, logging for that script |
| Node API, NUI dashboard, bridge | Agent-facing functions the agent calls |

**Do NOT** add script-specific events, handlers, or helpers inside `s4-doctor/server.lua`, `s4-doctor/client.lua`, or the Node API for a particular resource.

The agent talks to **any** script only via:

1. `POST /execute` → export / event / localFunction / command / resource
2. `GET /logs` → verify output
3. Optional `shared_script '@s4-doctor/doctor.lua'` + `Doctor.expose` **in the target script**

Example: vehicle spawn + enter vehicle + plate logging = code in **examples/doctor-test** (or your resource), not in s4-doctor.

---

## Setup

### Prerequisites

Standard FXServer builds include **yarn** and **webpack**. Ensure both run before `s4-doctor`:

```cfg
ensure yarn
ensure webpack
ensure s4-doctor
```

When `s4-doctor` starts, FiveM installs Node dependencies from `package.json` and launches the API on port **4789** automatically.

### FiveM resource

```cfg
ensure yarn
ensure webpack
ensure s4-doctor
set s4_doctor_bridge "http://127.0.0.1:4789"
set s4_doctor_poll_ms "500"
set s4_doctor_log_buffer "1000"
set s4_doctor_debug "false"
set s4_doctor_nui "true"
```

**Order:** `ensure yarn` → `ensure webpack` → `ensure s4-doctor`.

If the port is already in use (e.g. from a previous session), the launcher attaches to the existing instance; no conflict.

Optional: `set s4_doctor_port "4789"` — API port (default 4789).

### Resource lifecycle permissions (required for restart/ensure)

Grant s4-doctor permission to manage **other** resources. Copy from `server.cfg.example`:

```cfg
add_ace resource.s4-doctor command allow
```

This grants **all** server console commands to s4-doctor (ensure, restart, exec, etc.). Lua still blocks `restart/stop/refresh` on **s4-doctor itself**.

Optional explicit resource commands (redundant if `command allow` is set):

```cfg
add_ace resource.s4-doctor command.ensure allow
add_ace resource.s4-doctor command.restart allow
add_ace resource.s4-doctor command.start allow
add_ace resource.s4-doctor command.stop allow
add_ace resource.s4-doctor command.refresh allow
```

> **Safety:** s4-doctor **cannot** restart/stop/refresh **itself** (`s4-doctor`). Attempts are blocked in code to prevent hub crash.

### Target script (optional — for local function testing)

Add **manually** to `fxmanifest.lua`:

```lua
shared_script '@s4-doctor/doctor.lua'
```

Expose local functions in your script:

```lua
Doctor.expose('CalculateBill', CalculateBill)
```

> Export, event, and callback tests work through the hub **without** doctor.lua. `localFunction` requires doctor.lua.

---

## HTTP API (Node.js — port 4789)

No token. Localhost-only usage is assumed.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | FiveM connection status, last poll time |
| GET | `/logs` | Server + client logs (combined response) |
| GET | `/logs/server` | Server console logs only |
| GET | `/logs/client` | F8 logs from all players |
| GET | `/logs/client?playerId=1` | Client logs for a specific player |
| GET | `/doctors` | Registered doctor.lua scripts |
| POST | `/execute` | Run JSON command (sync, max 15s) |
| DELETE | `/logs?source=all` | Clear log buffer |

### Internal (FiveM ↔ Node, localhost only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/internal/register` | FiveM startup registration |
| GET | `/internal/pending` | Pending execute commands |
| POST | `/internal/result` | Execute result |
| POST | `/internal/logs` | Log push (batch) |
| POST | `/internal/doctors` | Doctor list sync |

### Query parameters (GET logs)

| Param | Description |
|-------|-------------|
| `since` | Unix ms — logs after this time |
| `sinceSeq` | Seq number — logs after this seq |
| `limit` | Max entries (default 100, max 500) |
| `level` | Filter: `info`, `warning`, `error` |
| `playerId` | Player ID for client logs |

### Response format (GET /logs)

```json
{
  "success": true,
  "server": { "count": 10, "logs": [...] },
  "client": { "count": 5, "logs": [...] },
  "meta": { "bufferSize": 1000, "latestSeq": 123 }
}
```

### POST /execute response

```json
{
  "success": true,
  "requestId": "req_abc123",
  "result": { "success": true, "data": {}, "via": "hub" },
  "logsSince": [...]
}
```

`logsSince`: brief summary of logs received after execute (for agent verification).

Console command:

```json
POST /execute
{ "command": "restart doctor-test" }
```

Resource lifecycle (blocked for `s4-doctor` itself):

```json
POST /execute
{
  "targetResource": "doctor-test",
  "executionType": "resource",
  "targetName": "restart"
}
```

Allowed `targetName` values: `ensure`, `restart`, `start`, `stop`, `refresh`.

---

## Agent Workflow (recommended)

```
1. GET /health          — verify API and FiveM connection
2. POST /execute { ... } — run command
3. GET /logs?sinceSeq=N  — check output after trigger
4. result.success + no errors in logs → OK
```

### Step by step

1. **Connect** — `GET /health` + `GET /status` (`fivemConnected: true` required)
2. **Open logs** — GET polling or NUI panel
3. **Discover** — read target script fxmanifest, export, event, callback names
4. **Detect framework** — ESX/QBCore/QBX/ox/standalone
5. **Test** — start with `export`, then `event`, then broad-impact commands last
6. **Verify** — `result.success` + `GET /logs?sinceSeq=...` for error logs
7. **Fix** — if errors, update command and retry

### Log polling

1. Update `sinceSeq` to the last received log
2. Every 1–2 seconds: `GET /logs?sinceSeq=...&limit=100`
3. For F8 logs: `GET /logs/client?playerId=1`

---

## Execute JSON Schema

```json
{
  "targetResource": "script_name",
  "executionType": "localFunction | export | event | frameworkCallback | command | resource",
  "frameworkType": "esx | qbcore | qbx | ox | vrp | standalone",
  "targetName": "FunctionEventExportName",
  "arguments": [],
  "side": "server | client",
  "playerId": 1
}
```

### Extra fields

| Field | When |
|-------|------|
| `eventSide` | For `event` type: `server` / `client` |
| `callbackSide` | For `frameworkCallback` type: `server` / `client` |
| `exportResource` | For exports from a different resource |

### executionType guide

| Type | doctor.lua | Description |
|------|------------|-------------|
| `localFunction` | **Required** | Local function registered via `Doctor.expose` |
| `export` | No | `exports[resource]:Function(...)` |
| `event` | No | `TriggerEvent` / `TriggerClientEvent` |
| `frameworkCallback` | No* | ESX/QBCore/QBX/ox_lib callback |
| `command` | No | `ExecuteCommand` (in-game) |
| `resource` | No | `ensure` / `restart` / `start` / `stop` / `refresh` — **never on `s4-doctor`** |

\* Client-side callback requires `side: "client"` and `playerId`.

### doctor-test sample

Copy `examples/doctor-test` to your resources folder first. See [examples/doctor-test/README.md](../examples/doctor-test/README.md).

```json
{
  "targetResource": "doctor-test",
  "executionType": "localFunction",
  "targetName": "AgentSpawnVehicle",
  "arguments": [2, "sultan", "AGENT01"],
  "side": "server"
}
```

Verify: `GET /logs?limit=20` → `[doctor-test][server][enter] player seated`

---

## Example Commands

### Export (without doctor)

```json
{
  "targetResource": "ox_inventory",
  "executionType": "export",
  "frameworkType": "ox",
  "targetName": "GetItemCount",
  "arguments": ["water"],
  "side": "server"
}
```

### Event (client)

```json
{
  "targetResource": "esx_ambulancejob",
  "executionType": "event",
  "frameworkType": "esx",
  "targetName": "esx_ambulancejob:revive",
  "arguments": [],
  "eventSide": "client",
  "side": "client",
  "playerId": 1
}
```

### Console command

```json
POST /execute
{ "command": "restart my_resource" }
```

---

## NUI Log Dashboard

Fullscreen NUI panel — shows server and client logs live.

- In-game: `/s4doctorui`
- Server console: `s4doctor ui`

CEF Remote Debugging: **http://localhost:13172/**

---

## Console Commands (FiveM)

```
s4doctor ui                                   — NUI panel info
/s4doctorui                                   — player: open NUI log panel
s4doctor logs [server|client|all] [limit]       — local log buffer
s4doctor clear [server|client|all]            — clear local logs
s4doctor doctors                              — registered doctors
s4doctor exec {"targetResource":"...", ...}   — JSON command (no token)
s4doctor bridge                               — re-register Node bridge
```

---

## Bridge Examples

- Node.js: `docs/scripts/example-node.js` — `executeAndVerify()`, `fetchLogs()`
- Python: `docs/scripts/example-python.py` — `execute_and_verify()`, `fetch_logs()`
- API server: `api/server.js`

Environment variables: `S4_DOCTOR_URL` (default `http://127.0.0.1:4789`), `S4_DOCTOR_PORT`

---

## Log Capture

| Side | Method |
|------|--------|
| Server | `RegisterConsoleListener` or `print` / `Citizen.Trace` hook |
| Client | `RegisterConsoleListener` — all script F8 logs |
| Agent | FiveM → Node push → `GET /logs` |

---

## Security

- Token system removed — use **localhost** only
- `/internal/*` endpoints accept requests from 127.0.0.1 only
- In production, firewall port 4789 from external access
- Do not trigger arbitrary events on unknown resources

---

## Example Agent Prompt

> Analyze the target FiveM resource. Monitor s4-doctor Node API logs (`GET http://127.0.0.1:4789/logs`).  
> Behavior to test: [DESCRIBE].  
> Detect the framework and produce a **JSON command** matching the s4-doctor protocol. Do not write raw Lua.  
> Test with `POST /execute`, then verify with `GET /logs?sinceSeq=...`.  
> Interpret log output and execute result together, then suggest the next step.
