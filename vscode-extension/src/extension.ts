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
    vscode.commands.registerCommand('s4-doctor.searchNatives', () => searchNatives()),
    vscode.commands.registerCommand('s4-doctor.searchPeds', () => searchPeds()),
    vscode.commands.registerCommand('s4-doctor.searchWeapons', () => searchWeapons()),
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

async function searchNatives(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Search FiveM natives by name, hash or keyword',
    placeHolder: 'e.g. SetEntityCoords, CreateVehicle, 0x06843DA7...',
  });

  if (!query) { return; }

  try {
    const result = await client.searchNatives(query, { limit: 30 });

    if (!result.success) {
      vscode.window.showErrorMessage(`s4-doctor natives: ${result.error ?? 'search failed'}`);
      return;
    }

    if (result.count === 0) {
      vscode.window.showInformationMessage(`No natives found for "${query}"`);
      return;
    }

    const picks = result.results.map((n) => ({
      label: n.name || n.hash,
      description: `${n.ns} — ${n.hash}`,
      detail: `(${n.params || 'void'}) → ${n.results}`,
      native: n,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: `${result.totalMatches} matches — select for details`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) { return; }

    // Fetch full details
    const info = await client.getNativeInfo(selected.native.ns, selected.native.hash);
    if (!info.success || !info.native) {
      vscode.window.showErrorMessage(`Could not load native details: ${info.error ?? 'unknown'}`);
      return;
    }

    const n = info.native;
    const lines: string[] = [
      '',
      `═══ ${n.name} ═══`,
      `Namespace: ${n.ns}`,
      `Hash:      ${n.hash}${n.jhash ? ` (jhash: ${n.jhash})` : ''}`,
      `Returns:   ${n.results}${n.resultsDescription ? ` — ${n.resultsDescription}` : ''}`,
      `Params:`,
    ];

    if (n.params.length === 0) {
      lines.push('  (none)');
    } else {
      for (const p of n.params) {
        lines.push(`  ${p.type} ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      }
    }

    if (n.description) {
      lines.push('', 'Description:', n.description.slice(0, 1000));
    }

    if (n.aliases?.length) {
      lines.push('', `Aliases: ${n.aliases.join(', ')}`);
    }

    if (n.examples?.length) {
      lines.push('');
      for (const ex of n.examples) {
        lines.push(`Example (${ex.lang}):`, ex.code, '');
      }
    }

    outputChannel.appendLine(lines.join('\n'));
    outputChannel.show(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`s4-doctor natives error: ${msg}`);
  }
}

async function searchPeds(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Search FiveM peds by name, hash or keyword',
    placeHolder: 'e.g. a_c_boar, 0xCE5FF074, animal, cop...',
  });

  if (!query) { return; }

  try {
    const result = await client.searchPeds(query, { limit: 30 });

    if (!result.success) {
      vscode.window.showErrorMessage(`s4-doctor peds: ${result.error ?? 'search failed'}`);
      return;
    }

    if (result.count === 0) {
      vscode.window.showInformationMessage(`No peds found for "${query}"`);
      return;
    }

    const picks = result.results.map((p) => ({
      label: p.name,
      description: `${p.pedtype} — ${p.dlc}`,
      detail: p.hexHash,
      ped: p,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: `${result.totalMatches} matches — select for details`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) { return; }

    // Fetch full details
    const info = await client.getPedInfo(selected.ped.name);
    if (!info.success || !info.ped) {
      vscode.window.showErrorMessage(`Could not load ped details: ${info.error ?? 'unknown'}`);
      return;
    }

    const p = info.ped;
    const translatedName = p.translatedName?.english || p.translatedName?.label;
    
    const lines: string[] = [
      '',
      `═══ ${p.name} ═══`,
      `Hash:      ${p.hexHash} (${p.hash}${p.signedHash !== p.hash ? ` / ${p.signedHash}` : ''})`,
      `Type:      ${p.pedtype}`,
      `DLC:       ${p.dlc}`,
      ...(translatedName ? [`Translated: ${translatedName}`] : []),
      '',
      `--- Details ---`,
      ...(p.personality ? [`Personality: ${p.personality}`] : []),
      ...(p.relationshipGroup ? [`Relationship Group: ${p.relationshipGroup}`] : []),
      ...(p.combatInfo ? [`Combat Info: ${p.combatInfo}`] : []),
      ...(p.defaultUnarmedWeapon ? [`Unarmed Weapon: ${p.defaultUnarmedWeapon}`] : []),
      ...(p.defaultBrawlingStyle ? [`Brawling Style: ${p.defaultBrawlingStyle}`] : []),
      ...(p.movementClipSet ? [`Movement Clip: ${p.movementClipSet}`] : []),
      ...(p.clipDictionaryName ? [`Clip Dict: ${p.clipDictionaryName}`] : []),
      ...(p.abilityType ? [`Ability Type: ${p.abilityType}`] : []),
      ...(p.pedVoiceGroup ? [`Voice Group: ${p.pedVoiceGroup}`] : []),
      '',
      `--- Flags ---`,
      `HeadBlend: ${p.isHeadBlendPed ? 'Yes' : 'No'}`,
      `SpawnInCar: ${p.canSpawnInCar ? 'Yes' : 'No'}`,
      '',
      `--- Bones (${p.boneCount}) ---`,
      `Sample: ${p.boneSample.join(', ')}${p.boneCount > 20 ? '...' : ''}`,
      '',
    ];

    outputChannel.appendLine(lines.join('\n'));
    outputChannel.show(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`s4-doctor peds error: ${msg}`);
  }
}

async function searchWeapons(): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'Search FiveM weapons by name, hash or keyword',
    placeHolder: 'e.g. WEAPON_PISTOL, 0x1B06D571, rifle, melee...',
  });

  if (!query) { return; }

  try {
    const result = await client.searchWeapons(query, { limit: 30 });

    if (!result.success) {
      vscode.window.showErrorMessage(`s4-doctor weapons: ${result.error ?? 'search failed'}`);
      return;
    }

    if (result.count === 0) {
      vscode.window.showInformationMessage(`No weapons found for "${query}"`);
      return;
    }

    const picks = result.results.map((w) => ({
      label: w.name,
      description: `${w.category} — ${w.dlc}`,
      detail: w.hexHash,
      weapon: w,
    }));

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: `${result.totalMatches} matches — select for details`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) { return; }

    // Fetch full details
    const info = await client.getWeaponInfo(selected.weapon.name);
    if (!info.success || !info.weapon) {
      vscode.window.showErrorMessage(`Could not load weapon details: ${info.error ?? 'unknown'}`);
      return;
    }

    const w = info.weapon;
    const translatedName = w.translatedName?.english || w.translatedName?.label;
    
    const lines: string[] = [
      '',
      `═══ ${w.name} ═══`,
      `Hash:      ${w.hexHash} (${w.hash}${w.signedHash !== w.hash ? ` / ${w.signedHash}` : ''})`,
      `Category:  ${w.category}`,
      `DLC:       ${w.dlc}`,
      ...(translatedName ? [`Translated: ${translatedName}`] : []),
      '',
      `--- Details ---`,
      ...(w.modelName ? [`Model Name: ${w.modelName}`] : []),
      ...(w.ammoType && w.ammoType !== 'NULL' ? [`Ammo Type: ${w.ammoType}`] : []),
      ...(w.ammoModelName ? [`Ammo Model: ${w.ammoModelName}`] : []),
      ...(w.damageType ? [`Damage Type: ${w.damageType}`] : []),
      `Is Vehicle Weapon: ${w.isVehicleWeapon ? 'Yes' : 'No'}`,
      '',
      ...(w.flags && w.flags.length > 0 ? [`--- Flags (${w.flags.length}) ---`, w.flags.join(', '), ''] : []),
      ...(w.components && w.components.length > 0 ? [`--- Components (${w.components.length}) ---`, w.components.join(', '), ''] : []),
      ...(w.tints && w.tints.length > 0 ? [`--- Tints (${w.tints.length}) ---`, w.tints.join(', '), ''] : []),
    ];

    outputChannel.appendLine(lines.join('\n'));
    outputChannel.show(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`s4-doctor weapons error: ${msg}`);
  }
}


