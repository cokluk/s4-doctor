# s4-doctor

**s4-doctor** is a FiveM debug hub for developers and AI agents. It collects server and client (F8) logs, exposes a localhost HTTP API, and routes structured test commands to your resources — without embedding script-specific logic in the hub itself.

```
Agent / IDE / Cursor
        │  HTTP :4789
        ▼
   Node.js API
        ▲ │
  logs  │ │ execute
        │ ▼
   s4-doctor (FiveM)
        │
        └──► your resource (exports, events, Doctor.expose)
```

## What it does

- **Log hub** — server console + client F8 logs in one buffer (NUI panel + HTTP API)
- **Execute router** — trigger exports, events, callbacks, console commands, resource lifecycle
- **Agent bridge** — Node.js API on port `4789` for Cursor, VS Code extension, MCP, or custom scripts
- **Optional inject** — `doctor.lua` lets agents call local functions via `Doctor.expose`

## Quick start

### 1. Install the resource

Copy the `s4-doctor` folder into your FiveM `resources` directory.

### 2. server.cfg

```cfg
ensure yarn
ensure webpack
ensure s4-doctor

set s4_doctor_bridge "http://127.0.0.1:4789"
add_ace resource.s4-doctor command allow
```

`yarn` and `webpack` are included on standard FXServer builds. When `s4-doctor` starts, FiveM installs Node dependencies from `package.json` and launches the API automatically — no `npm install` or `npm start` on the server.

### 3. Verify

```bash
curl http://127.0.0.1:4789/health
```

`fivemConnected: true` means the bridge is live.

### 4. Try the example

Copy `examples/doctor-test` to your resources folder (as `doctor-test`), add `ensure doctor-test` to `server.cfg`, then:

```bash
curl -X POST http://127.0.0.1:4789/execute \
  -H "Content-Type: application/json" \
  -d '{"targetResource":"doctor-test","executionType":"localFunction","targetName":"AgentSpawnVehicle","arguments":[1,"sultan","TEST01"],"side":"server"}'
```

See [examples/doctor-test/README.md](examples/doctor-test/README.md) for full test scenarios.

## Using with your own resource

**s4-doctor stays generic.** All test logic belongs in your script.

1. **Exports / events** — work out of the box via `POST /execute`
2. **Local functions** — add to your `fxmanifest.lua`:

```lua
shared_script '@s4-doctor/doctor.lua'
```

```lua
Doctor.expose('MyFunction', MyFunction)
```

3. **Agent workflow** — execute → read logs → fix → repeat

Full protocol: [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md)

## API overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | API + FiveM connection status |
| GET | `/logs` | Server + client logs |
| GET | `/players` | Online players |
| GET | `/doctors` | Registered doctor.lua scripts |
| POST | `/execute` | Run a structured command |

## In-game commands

| Command | Description |
|---------|-------------|
| `/s4doctorui` | Open log dashboard |
| `s4doctor logs [server\|client\|all]` | Server console: view buffer |
| `s4doctor exec {json}` | Server console: run execute payload |

## Project layout

```
s4-doctor/
├── api/              Node.js bridge (port 4789)
├── server.lua        Hub: logs, execute routing
├── client.lua        F8 capture, client execute relay
├── doctor.lua        Opt-in inject for target resources
├── examples/         Sample resources (not loaded automatically)
├── docs/             Agent guide + client script examples
│   └── scripts/      Node/Python API client samples
├── vscode-extension/ VS Code / Cursor extension
└── ui/               NUI log dashboard
```

## Security

- API is **localhost only** — do not expose port `4789` publicly
- s4-doctor **cannot** restart/stop itself (hub crash protection)
- Grant `add_ace resource.s4-doctor command allow` only on development servers

## Build & CI

For **contributors and GitHub Actions** only — not required on the FiveM server.

GitHub Actions validates the project on every push/PR:

| Job | What it checks |
|-----|----------------|
| **Node API** | syntax check, `/health` smoke test |
| **VS Code extension** | TypeScript compile |
| **MCP server** | syntax check |

Local development (extension / MCP):

```bash
cd vscode-extension && npm ci && npm run compile
cd vscode-extension/mcp && npm ci && node --check server.js
```

## Release

Push a version tag to trigger [`.github/workflows/release.yml`](.github/workflows/release.yml). GitHub Releases is created automatically with:

- `s4-doctor-{version}.zip` — FiveM resource (git-tracked files only)
- `cokluk.s4-doctor-{version}.vsix` — VS Code / Cursor extension

### First release (no tag yet)

1. Push this repo to GitHub (include `.github/workflows/release.yml`)
2. Open **Actions → Release → Run workflow**
3. Enter version `2.1.1` and run — the **Releases** page is populated automatically

### Later releases

```bash
git tag v2.1.2
git push origin v2.1.2
```

Use semver tags with a `v` prefix (`v2.1.1`, `v2.2.0`, …).

## Documentation

- [Agent guide](docs/AGENT_GUIDE.md) — execute JSON schema, workflow, API reference
- [Example: doctor-test](examples/doctor-test/README.md) — vehicle spawn integration test
- [Contributing](CONTRIBUTING.md) — how to help grow the project

## License

See [LICENSE](LICENSE).
