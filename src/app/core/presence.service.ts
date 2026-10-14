import { DOCUMENT, Injectable, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { timerTitle } from '../domain/presence';
import { DataService } from './data.service';
import { TimerService } from './timer.service';

export const APP_TITLE = 'WorkTrackLite';

/**
 * Makes a running timer visible outside the app window: the document title
 * (browser tab, task switcher) and the installed app's icon badge.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly data = inject(DataService);
  private readonly timer = inject(TimerService);
  private readonly title = inject(Title);
  private readonly navigator = inject(DOCUMENT).defaultView?.navigator;

  /** Title of the current route, set by `TimerTitleStrategy`. */
  readonly pageTitle = signal(APP_TITLE);

  private readonly running = computed(() => {
    const r = this.timer.running();
    if (!r) return null;
    return { nodeName: this.data.tree().get(r.nodeId)?.name ?? '(deleted)', elapsedSeconds: this.timer.elapsedSeconds() };
  });
  private readonly isRunning = computed(() => !!this.timer.running());

  constructor() {
    effect(() => this.title.setTitle(timerTitle(this.pageTitle(), this.running())));
    effect(() => this.updateBadge(this.isRunning()));
  }

  private updateBadge(running: boolean): void {
    const nav = this.navigator as (Navigator & { setAppBadge?: () => Promise<void>; clearAppBadge?: () => Promise<void> }) | undefined;
    // Only installed PWAs show badges; elsewhere these calls are no-ops or missing.
    const call = running ? nav?.setAppBadge?.() : nav?.clearAppBadge?.();
    call?.catch(() => undefined);
  }
}

/** Route titles go through PresenceService so the running timer can prefix them. */
@Injectable({ providedIn: 'root' })
export class TimerTitleStrategy extends TitleStrategy {
  private readonly presence = inject(PresenceService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.presence.pageTitle.set(this.buildTitle(snapshot) ?? APP_TITLE);
  }
}
