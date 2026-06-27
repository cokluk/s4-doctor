# Contributing to s4-doctor

Thank you for considering a contribution. s4-doctor is built for the FiveM developer community — every improvement to logging, agent tooling, framework support, or documentation helps everyone ship scripts faster.

## Ways to contribute

- **Bug reports** — open an issue with steps to reproduce, server artifact, and relevant logs from `GET /logs`
- **Feature requests** — describe the developer workflow you want to improve; keep the hub generic (no script-specific logic in core)
- **Pull requests** — fixes, docs, bridge examples, framework adapters, VS Code extension improvements
- **Example resources** — add new samples under `examples/` showing real integration patterns
- **Translations** — README or docs in other languages (keep code comments in English)

## Architecture rule

**Do not add target-script logic to s4-doctor core** (`server.lua`, `client.lua`, `api/server.js`).

| Core hub | Your resource / `examples/` |
|----------|----------------------------|
| Log capture, execute routing | Spawn, gameplay, business logic |
| `doctor.lua` inject file | `Doctor.expose`, exports, events |
| Node API | Agent-facing test functions |

If a feature is specific to one script, it belongs in that script or in `examples/`, not in the hub.

## Development setup

1. Clone the repo into your FiveM `resources` folder
2. Add to `server.cfg`:

```cfg
ensure yarn
ensure webpack
ensure s4-doctor
set s4_doctor_bridge "http://127.0.0.1:4789"
add_ace resource.s4-doctor command allow
```

3. Copy `examples/doctor-test` to resources for integration testing
4. Use `GET http://127.0.0.1:4789/health` and `POST /execute` to validate changes
5. CI runs automatically on push — see [.github/workflows/ci.yml](.github/workflows/ci.yml)

## Pull request checklist

- [ ] Changes stay within scope — hub remains generic
- [ ] No secrets or server IPs committed
- [ ] Docs updated if behaviour or API changed
- [ ] Tested against a running FiveM server with at least one online player (for client-side paths)

## Code style

- Lua: `lua54`, match existing naming and structure
- JavaScript: follow `api/server.js` conventions
- Comments: only where behaviour is non-obvious; avoid verbose banners
- English for all user-facing docs and log messages

## Community

We want s4-doctor to become the standard debug layer for FiveM script development — human developers and AI agents working on the same logs and the same execute protocol. Whether you fix a timeout edge case, add QBCore callback support, or write a better Cursor rule, your contribution moves the whole ecosystem forward.

Questions and ideas are welcome in issues. Let's build this together.
