import * as vscode from 'vscode';
import { formatLogEntry, LogEntry, S4DoctorClient } from './apiClient';

export class LogWatcher implements vscode.Disposable {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastSince = 0;
  private lastSinceSeq = 0;
  private disposed = false;

  constructor(
    private client: S4DoctorClient,
    private output: vscode.OutputChannel,
    private onConnectionChange?: (connected: boolean, fivemConnected: boolean) => void
  ) {}

  start(): void {
    this.stop();
    const interval = vscode.workspace.getConfiguration('s4-doctor').get<number>('pollInterval', 2000);
    this.poll();
    this.timer = setInterval(() => this.poll(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  resetCursor(): void {
    this.lastSince = 0;
    this.lastSinceSeq = 0;
  }

  async pollOnce(): Promise<LogEntry[]> {
    return this.poll(true);
  }

  private async poll(forceLogs = false): Promise<LogEntry[]> {
    if (this.disposed) return [];

    const autoPoll = vscode.workspace.getConfiguration('s4-doctor').get<boolean>('autoPoll', true);
    const newEntries: LogEntry[] = [];

    try {
      const health = await this.client.health();
      this.onConnectionChange?.(true, health.fivemConnected);

      if (!autoPoll && !forceLogs) return [];

      const data = await this.client.fetchLogs({
        since: this.lastSince,
        sinceSeq: this.lastSinceSeq,
        limit: 200,
      });

      const batches: LogEntry[] = [];
      if (data.server?.logs) batches.push(...data.server.logs);
      if (data.client?.logs) batches.push(...data.client.logs);

      for (const entry of batches) {
        this.output.appendLine(formatLogEntry(entry));
        newEntries.push(entry);
        if (entry.timestamp > this.lastSince) this.lastSince = entry.timestamp;
        if (entry.seq > this.lastSinceSeq) this.lastSinceSeq = entry.seq;
      }
    } catch {
      this.onConnectionChange?.(false, false);
    }

    return newEntries;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
