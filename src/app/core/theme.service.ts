import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { DataService } from './data.service';

/** Applies the theme preference (dark / light / follow the OS) to <html data-theme>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly data = inject(DataService);
  private readonly document = inject(DOCUMENT);
  private readonly systemDark = signal(true);

  readonly effective = computed<'dark' | 'light'>(() => {
    const pref = this.data.settings().theme;
    return pref === 'system' ? (this.systemDark() ? 'dark' : 'light') : pref;
  });

  constructor() {
    const mq = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq) {
      this.systemDark.set(mq.matches);
      mq.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() => {
      const t = this.effective();
      this.document.documentElement.dataset['theme'] = t;
      this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#15171c' : '#fafbfc');
    });
  }

  toggle(): Promise<void> {
    return this.data.updateSettings({ theme: this.effective() === 'dark' ? 'light' : 'dark' });
  }
}
