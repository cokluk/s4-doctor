import * as vscode from 'vscode';
import { S4DoctorClient } from './apiClient';

export interface DiagnosticItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export class DoctorPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private client: S4DoctorClient) {}

  async show(): Promise<DiagnosticItem[]> {
    const items = await this.runDiagnostics();

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.panel.webview.html = this.renderHtml(items);
      return items;
    }

    this.panel = vscode.window.createWebviewPanel(
      's4DoctorCheck',
      's4-doctor Check',
      vscode.ViewColumn.One,
      { enableScripts: false, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.renderHtml(items);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'refresh') {
        const refreshed = await this.runDiagnostics();
        this.panel!.webview.html = this.renderHtml(refreshed);
      }
    });

    return items;
  }

  async runDiagnostics(): Promise<DiagnosticItem[]> {
    const items: DiagnosticItem[] = [];

    try {
      const health = await this.client.health();
      items.push({
        id: 'api',
        label: 'Node API reachable',
        ok: health.ok === true,
        detail: `${health.service} v${health.version} on port ${health.port}`,
      });

      items.push({
        id: 'fivem',
        label: 'FiveM connected',
        ok: health.fivemConnected,
        detail: health.fivemConnected
          ? 'FiveM resource is polling the bridge'
          : 'No recent poll from FiveM server',
        fix: health.fivemConnected
          ? undefined
          : 'Add `ensure yarn` and `ensure s4-doctor` to server.cfg, then restart the server.',
      });

      let yarnOk = false;
      let yarnDetail = 'Cannot verify — FiveM not connected';
      try {
        const status = await this.client.status();
        yarnOk = status.fivem.connected && status.fivem.resource === 's4-doctor';
        yarnDetail = status.fivem.resource
          ? `Resource: ${status.fivem.resource} v${status.fivem.version ?? '?'}`
          : 's4-doctor resource not registered';
      } catch {
        yarnDetail = 'Status endpoint unavailable';
      }
      items.push({
        id: 'yarn',
        label: 'Yarn + s4-doctor resource',
        ok: yarnOk,
        detail: yarnDetail,
        fix: yarnOk ? undefined : 'Run `ensure yarn` then `ensure s4-doctor` in your FiveM server console.',
      });

      const totalLogs = health.serverLogs + health.clientLogs;
      const bufferPct = Math.round((totalLogs / health.logBufferSize) * 100);
      items.push({
        id: 'logs',
        label: 'Log buffer status',
        ok: bufferPct < 90,
        detail: `${totalLogs}/${health.logBufferSize} entries (server: ${health.serverLogs}, client: ${health.clientLogs})`,
        fix: bufferPct >= 90 ? 'Run "s4-doctor: Clear Logs" or DELETE /logs?source=all' : undefined,
      });

      try {
        const doctors = await this.client.listDoctors();
        const serverCount = doctors.server?.length ?? 0;
        const clientCount = doctors.client?.length ?? 0;
        const total = serverCount + clientCount;
        items.push({
          id: 'doctors',
          label: 'doctor.lua registrations',
          ok: total > 0,
          detail: `${total} resource(s) — server: ${serverCount}, client: ${clientCount}`,
          fix:
            total === 0
              ? "Add `shared_script '@s4-doctor/doctor.lua'` to target resource fxmanifest, then `ensure` it."
              : undefined,
        });
      } catch {
        items.push({
          id: 'doctors',
          label: 'doctor.lua registrations',
          ok: false,
          detail: 'Could not fetch /doctors',
          fix: 'Ensure s4-doctor API is running.',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      items.push({
        id: 'api',
        label: 'Node API reachable',
        ok: false,
        detail: msg,
        fix: 'Start FiveM with `ensure s4-doctor` — the Node API launches automatically on port 4789.',
      });
    }

    return items;
  }

  private renderHtml(items: DiagnosticItem[]): string {
    const rows = items
      .map((item) => {
        const icon = item.ok ? '✓' : '✗';
        const cls = item.ok ? 'ok' : 'fail';
        const fixHtml = item.fix
          ? `<div class="fix"><strong>Fix:</strong> ${escapeHtml(item.fix)}</div>`
          : '';
        return `
          <div class="item ${cls}">
            <div class="head"><span class="icon">${icon}</span> ${escapeHtml(item.label)}</div>
            <div class="detail">${escapeHtml(item.detail)}</div>
            ${fixHtml}
          </div>`;
      })
      .join('');

    const allOk = items.every((i) => i.ok);
    const summary = allOk
      ? 'All checks passed — s4-doctor is ready for AI-assisted debugging.'
      : `${items.filter((i) => !i.ok).length} issue(s) found — see fix suggestions below.`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 20px;
      line-height: 1.5;
    }
    h1 { font-size: 1.3em; margin: 0 0 4px; }
    .summary { opacity: 0.85; margin-bottom: 20px; }
    .item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .item.ok { border-left: 4px solid #3fb950; }
    .item.fail { border-left: 4px solid #f85149; }
    .head { font-weight: 600; font-size: 1.05em; }
    .icon { margin-right: 6px; }
    .detail { opacity: 0.8; margin-top: 4px; font-size: 0.92em; }
    .fix {
      margin-top: 8px;
      padding: 8px 10px;
      background: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
      font-size: 0.9em;
    }
    button {
      margin-top: 16px;
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .api-url { font-size: 0.85em; opacity: 0.6; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>s4-doctor Check</h1>
  <p class="summary">${escapeHtml(summary)}</p>
  ${rows}
  <button onclick="refresh()">Refresh</button>
  <p class="api-url">API: ${escapeHtml(this.client.baseUrl)}</p>
  <script>
    const vscode = acquireVsCodeApi();
    function refresh() { vscode.postMessage({ type: 'refresh' }); }
  </script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDiagnosticsReport(items: DiagnosticItem[]): string {
  const lines = ['s4-doctor Diagnostic Report', '═'.repeat(40)];
  for (const item of items) {
    lines.push(`${item.ok ? '✓' : '✗'} ${item.label}`);
    lines.push(`  ${item.detail}`);
    if (item.fix) lines.push(`  → Fix: ${item.fix}`);
    lines.push('');
  }
  const failed = items.filter((i) => !i.ok).length;
  lines.push(failed === 0 ? 'All checks passed.' : `${failed} issue(s) need attention.`);
  return lines.join('\n');
}
