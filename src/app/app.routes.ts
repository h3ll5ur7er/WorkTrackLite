import { Routes } from '@angular/router';
import { shortcutActionGuard } from './core/shortcut-actions';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ManageComponent } from './features/manage/manage.component';
import { ReportsComponent } from './features/reports/reports.component';
import { ScheduleComponent } from './features/schedule/schedule.component';
import { SearchComponent } from './features/search/search.component';
import { SettingsComponent } from './features/settings/settings.component';

// Routes are eagerly loaded on purpose: the single-file build inlines exactly
// one JS bundle, so lazy chunks (loadComponent) would break it. The inliner
// script fails the build if extra chunks appear.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent, title: 'Dashboard · Where Time Flew' },
  { path: 'schedule', component: ScheduleComponent, title: 'Schedule · Where Time Flew' },
  { path: 'reports', component: ReportsComponent, title: 'Reports · Where Time Flew' },
  { path: 'manage', component: ManageComponent, title: 'Manage · Where Time Flew' },
  { path: 'manage/:nodeId', component: ManageComponent, title: 'Manage · Where Time Flew' },
  { path: 'settings', component: SettingsComponent, title: 'Settings · Where Time Flew' },
  { path: 'search', component: SearchComponent, title: 'Search · Where Time Flew' },
  // App-icon shortcuts (web manifest): run the action, then redirect.
  { path: 'action/:name', canActivate: [shortcutActionGuard], children: [] },
  { path: '**', redirectTo: 'dashboard' },
];
