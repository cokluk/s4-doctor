# doctor-test

Example resource for **s4-doctor**. Spawns a vehicle, sets a custom plate, warps the player into the driver seat, and logs every step for agent verification.

## Installation

1. Copy this folder to your FiveM `resources` directory (keep the resource name `doctor-test`)
2. Add to `server.cfg`:

```cfg
ensure yarn
ensure webpack
ensure s4-doctor
ensure doctor-test

set s4_doctor_bridge "http://127.0.0.1:4789"
add_ace resource.s4-doctor command allow
```

3. Restart the server or run `ensure doctor-test`

## In-game command

```
/doctortest [model] [plate]
/doctortest sultan DOCTOR
```

## Agent tests

Replace `playerId` with an online player (`GET /players`).

### Spawn + enter vehicle (server — recommended on Qbox/QBCore)

```json
{
  "targetResource": "doctor-test",
  "executionType": "localFunction",
  "targetName": "AgentSpawnVehicle",
  "arguments": [2, "sultan", "TEST01"],
  "side": "server"
}
```

### Spawn (client — requires doctor-test client loaded)

```json
{
  "targetResource": "doctor-test",
  "executionType": "localFunction",
  "targetName": "SpawnTestVehicle",
  "arguments": ["sultan", "TEST01"],
  "side": "client",
  "playerId": 2
}
```

### Verify logs

```
GET http://127.0.0.1:4789/logs?limit=30
```

Expected server lines:

```
[doctor-test][server][spawn] agent spawn requested | player=2 | ...
[doctor-test][server][enter] player seated #1 | player=2 | plate=TEST01 | ...
```

### Restart after code changes

```json
{
  "targetResource": "doctor-test",
  "executionType": "resource",
  "targetName": "restart"
}
```

## Exposed API

| Name | Side | Description |
|------|------|-------------|
| `SpawnTestVehicle` | client | Spawn in front of player, warp into seat |
| `GetLastSpawnInfo` | client | Active vehicle info |
| `DeleteTestVehicle` | client | Remove test vehicle |
| `WarpIntoTestVehicle` | client | Warp into netId vehicle |
| `AgentSpawnVehicle` | server | Spawn + warp (QBCore/QBX/server-setter) |
| `GetSpawnCount` | server | `{ count, enterCount }` |

## Exports

- `exports['doctor-test']:SpawnTestVehicle(model, plate)`
- `exports['doctor-test']:AgentSpawnVehicle(playerId, model, plate)`
- `exports['doctor-test']:GetSpawnCount()`
