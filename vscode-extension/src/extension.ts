import * as vscode from 'vscode';
import { getApiUrl, S4DoctorClient } from './apiClient';
import { DoctorPanel, formatDiagnosticsReport } from './doctorPanel';
import { LogWatcher } from './logWatcher';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let client: S4DoctorClient;
let logWatcher: LogWatcher;
let doctorPanel: DoctorPanel;

const EXECUTE_TEMPLATE = `{
  "targetResource": "my-resource",
  "executionType": "export",
  "frameworkType": "ox",
  "targetName": "MyFunction",
  "arguments": [],
  "side": "server"
}`;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('s4-doctor');
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 's4-doctor.checkHealth';
  statusBarItem.tooltip = 's4-doctor — click to run doctor check';
  statusBarItem.show();

  client = new S4DoctorClient(getApiUrl);
  doctorPanel = new DoctorPanel(client);

  logWatcher = new LogWatcher(client, outputChannel, updateStatusBar);
  logWatcher.start();

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    logWatcher,
    vscode.commands.registerCommand('s4-doctor.checkHealth', () => checkHealth()),
    vscode.commands.registerCommand('s4-doctor.showLogs', () => showLogs()),
    vscode.commands.registerCommand('s4-doctor.execute', () => executeCommand()),
    vscode.commands.registerCommand('s4-doctor.clearLogs', () => clearLogs()),
    vscode.commands.registerCommand('s4-doctor.openDashboard', () => openDashboard()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('s4-doctor.apiUrl') || e.affectsConfiguration('s4-doctor.pollInterval')) {
        client = new S4DoctorClient(getApiUrl);
        doctorPanel = new DoctorPanel(client);
        logWatcher.dispose();
        logWatcher = new LogWatcher(client, outputChannel, updateStatusBar);
        logWatcher.start();
      }
      if (e.affectsConfiguration('s4-doctor.autoPoll')) {
        logWatcher.start();
      }
    })
  );

  updateStatusBar(false, false);
}

export function deactivate(): void {
  logWatcher?.dispose();
}

function updateStatusBar(apiOk: boolean, fivemConnected: boolean): void {
  if (!apiOk) {
    statusBarItem.text = '$(debug-disconnect) s4-doctor: Disconnected ✗';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (!fivemConnected) {
    statusBarItem.text = '$(warning) s4-doctor: API OK, FiveM ✗';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = '$(debug-start) s4-doctor: Connected ✓';
    statusBarItem.backgroundColor = undefined;
  }
}

async function checkHealth(): Promise<void> {
  const items = await doctorPanel.show();
  const report = formatDiagnosticsReport(items);
  outputChannel.appendLine('');
  outputChannel.appendLine(report);
  outputChannel.show(true);

  const failed = items.filter((i) => !i.ok).length;
  if (failed === 0) {
    vscode.window.showInformationMessage('s4-doctor: All checks passed ✓');
  } else {
    vscode.window.showWarningMessage(`s4-doctor: ${failed} issue(s) found — see Doctor Check panel`);
  }
}

function showLogs(): void {
  outputChannel.show(true);
}

async function executeCommand(): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: 'Execute JSON command (POST /execute)',
    value: EXECUTE_TEMPLATE,
    validateInput: (v) => {
      try {
        JSON.parse(v);
        return null;
      } catch {
        return 'Invalid JSON';
      }
    },
  });

  if (!input) return;

  try {
    const body = JSON.parse(input) as Record<string, unknown>;
    outputChannel.appendLine('');
    outputChannel.appendLine(`→ POST /execute ${JSON.stringify(body)}`);

    const result = await client.execute(body);
    outputChannel.appendLine(`← ${JSON.stringify(result, null, 2)}`);

    if (result.logsSince?.length) {
      outputChannel.appendLine('--- logs since execute ---');
      for (const entry of result.logsSince) {
        outputChannel.appendLine(`  [${entry.level}] ${entry.message}`);
      }
    }

    await logWatcher.pollOnce();
    outputChannel.show(true);

    if (result.success) {
      vscode.window.showInformationMessage('s4-doctor: Execute succeeded');
    } else {
      vscode.window.showErrorMessage(`s4-doctor: Execute failed — ${result.error ?? 'unknown error'}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`s4-doctor execute error: ${msg}`);
  }
}

async function clearLogs(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'All logs', value: 'all' as const },
      { label: 'Server logs', value: 'server' as const },
      { label: 'Client logs', value: 'client' as const },
    ],
    { placeHolder: 'Which logs to clear?' }
  );

  if (!pick) return;

  try {
    await client.clearLogs(pick.value);
    logWatcher.resetCursor();
    outputChannel.clear();
    outputChannel.appendLine(`Logs cleared (${pick.value})`);
    vscode.window.showInformationMessage(`s4-doctor: Cleared ${pick.value} logs`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`s4-doctor clear error: ${msg}`);
  }
}

async function openDashboard(): Promise<void> {
  const url = `${getApiUrl()}/health`;
  const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
  if (!opened) {
    vscode.window.showWarningMessage(`Could not open browser. Visit: ${url}`);
  }
}
