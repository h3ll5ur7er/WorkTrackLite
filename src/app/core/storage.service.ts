import { Injectable, signal } from '@angular/core';

export type PersistState = 'persisted' | 'best-effort' | 'unsupported';

/**
 * Browsers may evict IndexedDB data under storage pressure (Safari even after
 * 7 days without a visit). Asking for persistent storage prevents that where
 * the browser grants it.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  readonly state = signal<PersistState>('best-effort');
  readonly usage = signal<{ usage: number; quota: number } | null>(null);

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persisted) {
      this.state.set('unsupported');
      return;
    }
    this.state.set((await storage.persisted()) ? 'persisted' : 'best-effort');
    if (storage.estimate) {
      const { usage = 0, quota = 0 } = await storage.estimate();
      this.usage.set({ usage, quota });
    }
  }

  /** Requests persistent storage. Some browsers ask the user; others decide silently. */
  async requestPersistence(): Promise<PersistState> {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist) {
      this.state.set('unsupported');
      return 'unsupported';
    }
    try {
      this.state.set((await storage.persist()) ? 'persisted' : 'best-effort');
    } catch {
      this.state.set('best-effort');
    }
    return this.state();
  }
}
