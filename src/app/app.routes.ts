import { Routes } from '@angular/router';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { ManageComponent } from './features/manage/manage.component';
import { ScheduleComponent } from './features/schedule/schedule.component';
import { SettingsComponent } from './features/settings/settings.component';

// Routes are eagerly loaded on purpose: the single-file build inlines exactly
// one JS bundle, so lazy chunks (loadComponent) would break it. The inliner
// script fails the build if extra chunks appear.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', component: DashboardComponent, title: 'Dashboard · WorkTrackLite' },
  { path: 'schedule', component: ScheduleComponent, title: 'Schedule · WorkTrackLite' },
  { path: 'manage', component: ManageComponent, title: 'Manage · WorkTrackLite' },
  { path: 'manage/:nodeId', component: ManageComponent, title: 'Manage · WorkTrackLite' },
  { path: 'settings', component: SettingsComponent, title: 'Settings · WorkTrackLite' },
  { path: '**', redirectTo: 'dashboard' },
];
