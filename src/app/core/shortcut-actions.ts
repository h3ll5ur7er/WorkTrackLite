import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DataService } from './data.service';
import { TimerService } from './timer.service';
import { ToastService } from './toast.service';

/**
 * Handles `#/action/:name` URLs, used by the app-icon shortcuts in the web
 * manifest (long-press the installed app icon). Runs the action, then lands
 * on the dashboard.
 */
export const shortcutActionGuard: CanActivateFn = async (route) => {
  const data = inject(DataService);
  const timer = inject(TimerService);
  const toast = inject(ToastService);
  const router = inject(Router);
  await data.whenReady();
  const name = route.paramMap.get('name');
  if (name === 'resume') {
    const change = await timer.resumeLast();
    const node = change.started ? data.tree().get(change.started.nodeId) : undefined;
    toast.show(node ? `Resumed ${node.name}` : timer.running() ? 'A timer is already running' : 'Nothing to resume yet');
  } else if (name === 'stop') {
    const change = await timer.stop();
    toast.show(change.closed.length ? 'Timer stopped' : 'No timer was running');
  }
  return router.parseUrl('/dashboard');
};
