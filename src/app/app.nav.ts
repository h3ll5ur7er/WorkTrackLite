/** Top-level navigation, shared by the header, the mobile bottom bar and the command palette. */
export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '▦' },
  { path: '/schedule', label: 'Schedule', icon: '🗓' },
  { path: '/manage', label: 'Manage', icon: '☰' },
  { path: '/settings', label: 'Settings', icon: '⚙' },
] as const;
