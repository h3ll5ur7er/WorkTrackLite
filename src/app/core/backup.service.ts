import { Injectable, inject } from '@angular/core';
import { BackupData, backupFileName, createBackup, parseBackup } from '../domain/backup';
import { downloadFile } from '../shared/download';
import { DataService } from './data.service';

/** JSON backup export/import on top of DataService. */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly data = inject(DataService);

  async exportToFile(): Promise<void> {
    const now = Date.now();
    const snapshot = await this.data.snapshot();
    const file = createBackup({ ...snapshot, settings: { ...snapshot.settings, lastBackupAt: now } }, now);
    downloadFile(backupFileName(now), JSON.stringify(file, null, 2), 'application/json');
    await this.data.updateSettings({ lastBackupAt: now });
  }

  /** Validates a backup file; nothing is written. */
  async read(file: Blob): Promise<{ ok: true; data: BackupData; warnings: string[] } | { ok: false; error: string }> {
    return parseBackup(await file.text());
  }

  /** Replaces all local data with the backup. */
  async restore(data: BackupData): Promise<void> {
    await this.data.replaceAll(data);
  }
}
