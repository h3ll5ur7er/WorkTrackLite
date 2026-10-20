import { Injectable, inject } from '@angular/core';
import { BackupData, ParseResult, backupFileName, createBackup, parseBackup } from '../domain/backup';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '../domain/backup-crypto';
import { downloadFile } from '../shared/download';
import { BudgetAlertService } from './budget-alert.service';
import { DataService } from './data.service';

/** A password-protected file: call `unlock` with its text and the password. */
export interface LockedBackup {
  ok: false;
  locked: true;
  text: string;
  error: string;
}

/** JSON backup export/import on top of DataService. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly data = inject(DataService);
  private readonly alerts = inject(BudgetAlertService);

  /** Downloads a backup; with a password it is encrypted (see domain/backup-crypto.ts). */
  async exportToFile(password?: string): Promise<void> {
    const now = Date.now();
    const snapshot = await this.data.snapshot();
    const file = createBackup({ ...snapshot, settings: { ...snapshot.settings, lastBackupAt: now } }, now);
    const json = JSON.stringify(file, null, 2);
    const content = password ? await encryptBackup(json, password) : json;
    downloadFile(backupFileName(now, !!password), content, 'application/json');
    await this.data.updateSettings({ lastBackupAt: now });
  }

  /** Validates a backup file; nothing is written. Encrypted files come back as `locked`. */
  async read(file: Blob): Promise<ParseResult | LockedBackup> {
    const text = await file.text();
    if (isEncryptedBackup(text)) return { ok: false, locked: true, text, error: 'This backup is password-protected.' };
    return parseBackup(text);
  }

  /** Decrypts and validates a locked backup; nothing is written. */
  async unlock(text: string, password: string): Promise<ParseResult> {
    try {
      return parseBackup(await decryptBackup(text, password));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Replaces all local data with the backup. */
  async restore(data: BackupData): Promise<void> {
    this.alerts.rebaseline(data);
    await this.data.replaceAll(data);
  }
}
