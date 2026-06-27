# s4-doctor — VS Code / Cursor Extension

Flutter `doctor`-style debug companion for FiveM scripting. Connects to the s4-doctor Node.js API at `http://127.0.0.1:4789`.

---

## Install

**Prerequisite — FiveM server:**

```cfg
ensure yarn
ensure webpack
ensure s4-doctor
```

FiveM installs Node dependencies and starts the API when the resource loads — no server-side `npm install` required.

**Extension install (3 methods):**

1. **Dev mode:** Open the `vscode-extension` folder → `npm install && npm run compile` → F5
2. **From location:** Command Palette → `Developer: Install Extension from Location` → select `vscode-extension/`
3. **VSIX:** `npx @vscode/vsce package` → install the `.vsix` from the Extensions panel

### Features

| Feature | Description |
|---------|-------------|
| Status Bar | `Connected ✓` / `Disconnected ✗` — API + FiveM status |
| Output Channel | `s4-doctor` — live log stream (2s polling) |
| Doctor Check | Flutter doctor-style diagnostic panel |
| Commands | Health, logs, execute, clear, dashboard |
| Snippets | `doctor-expose`, `doctor-fxmanifest`, `doctor-execute-export` |
| AI Rules | `.cursor/rules/s4-doctor.mdc` — Cursor agent instructions |

### Commands

- `s4-doctor: Run Doctor Check` — diagnostic report
- `s4-doctor: Show Logs` — log panel
- `s4-doctor: Execute Command (JSON)` — POST /execute
- `s4-doctor: Clear Logs` — clear logs
- `s4-doctor: Open Dashboard` — open /health in browser

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `s4-doctor.apiUrl` | `http://127.0.0.1:4789` | API base URL |
| `s4-doctor.pollInterval` | `2000` | Log polling interval (ms) |
| `s4-doctor.autoPoll` | `true` | Automatic log monitoring |

### AI Agent Integration

1. Copy `.cursor/rules/s4-doctor.mdc` to your workspace `.cursor/rules/` folder
2. Read `AGENT_INTEGRATION.md` — guide for all agents
3. (Optional) MCP server: `cd mcp && npm install` → add to Cursor MCP settings

See [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md) for full AI agent setup.

### Build

```bash
cd vscode-extension
npm install
npm run compile
```

---

## File Structure

```
vscode-extension/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts      # Main entry, commands, status bar
│   ├── apiClient.ts      # HTTP client for localhost:4789
│   ├── doctorPanel.ts    # Diagnostic webview
│   └── logWatcher.ts     # Log polling
├── snippets/lua.json
├── .cursor/rules/s4-doctor.mdc
├── mcp/                  # Optional MCP server for Cursor
├── AGENT_INTEGRATION.md
└── README.md
```
