#!/usr/bin/env python3
"""s4-doctor API client — Python example. Log reads + execute."""

import json
import os
import time
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("S4_DOCTOR_URL", "http://127.0.0.1:4789")

_last_since = 0
_last_since_seq = 0


def _request(
    method: str,
    path: str,
    payload: dict | None = None,
) -> dict:
    url = f"{BASE_URL}{path}"
    hdrs = {"Content-Type": "application/json"}
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def health() -> dict:
    return _request("GET", "/health")


def status() -> dict:
    return _request("GET", "/status")


def _process_entries(data: dict) -> None:
    global _last_since, _last_since_seq
    batches = []
    if data.get("server", {}).get("logs"):
        batches.extend(data["server"]["logs"])
    if data.get("client", {}).get("logs"):
        batches.extend(data["client"]["logs"])

    for entry in batches:
        side = entry.get("side") or entry.get("source")
        if side == "client":
            tag = f"[client:{entry.get('playerId')} {entry.get('playerName', '')}]"
        else:
            tag = "[server]"
        print(f"{tag} [{entry.get('level')}] #{entry.get('seq')} {entry.get('message')}")
        ts = entry.get("timestamp", 0)
        if ts > _last_since:
            _last_since = ts
        seq = entry.get("seq", 0)
        if seq > _last_since_seq:
            _last_since_seq = seq


def fetch_logs(
    endpoint: str = "/logs",
    limit: int = 100,
    player_id: int | None = None,
    level: str | None = None,
    since_seq: int | None = None,
) -> dict:
    params = {
        "since": str(_last_since),
        "sinceSeq": str(since_seq if since_seq is not None else _last_since_seq),
        "limit": str(limit),
    }
    if player_id is not None:
        params["playerId"] = str(player_id)
    if level:
        params["level"] = level

    qs = urllib.parse.urlencode(params)
    data = _request("GET", f"{endpoint}?{qs}")
    _process_entries(data)
    return data


def fetch_server_logs(limit: int = 100) -> dict:
    return fetch_logs("/logs/server", limit=limit)


def fetch_client_logs(player_id: int | None = None, limit: int = 100) -> dict:
    return fetch_logs("/logs/client", limit=limit, player_id=player_id)


def poll_logs(interval_sec: float = 1.5) -> None:
    print(f"Log polling started ({interval_sec}s)...")
    while True:
        try:
            fetch_logs()
        except Exception as exc:
            print("poll error:", exc)
        time.sleep(interval_sec)


def list_doctors() -> dict:
    return _request("GET", "/doctors")


def execute(command: dict) -> dict:
    return _request("POST", "/execute", command)


def run_console_command(command: str) -> dict:
    return _request("POST", "/execute", {"command": command})


def clear_logs(source: str = "all") -> dict:
    qs = urllib.parse.urlencode({"source": source})
    return _request("DELETE", f"/logs?{qs}")


def execute_and_verify(command: dict, log_limit: int = 50) -> dict:
    before = fetch_logs(limit=1)
    since_seq = before.get("meta", {}).get("latestSeq", _last_since_seq)

    result = execute(command)
    logs = fetch_logs(since_seq=since_seq, limit=log_limit)

    batches = []
    if logs.get("server", {}).get("logs"):
        batches.extend(logs["server"]["logs"])
    if logs.get("client", {}).get("logs"):
        batches.extend(logs["client"]["logs"])
    has_error = any(e.get("level") == "error" for e in batches)

    return {"ok": result.get("success") is True and not has_error, "result": result, "logs": logs}


if __name__ == "__main__":
    print(health())
    print(status())
    print(list_doctors())
    print(fetch_server_logs(limit=10))
    print(
        execute(
            {
                "targetResource": "qb-core",
                "executionType": "export",
                "frameworkType": "qbcore",
                "targetName": "GetCoreObject",
                "arguments": [],
                "side": "server",
            }
        )
    )
    # poll_logs()  # uncomment for continuous log listening
