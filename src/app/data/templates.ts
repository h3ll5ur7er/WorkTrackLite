import { HierarchyTemplate } from './models';

export const BUILTIN_TEMPLATES: HierarchyTemplate[] = [
  { id: 'dev',        name: 'Software Development', levels: ['Customer', 'Project', 'Phase', 'Task'] },
  { id: 'accounting', name: 'Accounting',           levels: ['Client', 'Engagement', 'Activity'] },
  { id: 'consulting', name: 'Consulting',           levels: ['Account', 'Engagement', 'Workstream', 'Deliverable'] },
  { id: 'personal',   name: 'Personal',             levels: ['Area', 'Project', 'Task'] },
];
