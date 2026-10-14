import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { TimerTitleStrategy } from './core/presence.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash URLs work everywhere the app is hosted: GitHub Pages sub-paths,
    // any static server, and the single-file build opened from file://.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    { provide: TitleStrategy, useClass: TimerTitleStrategy },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
