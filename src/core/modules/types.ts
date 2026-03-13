import type { ComponentType } from 'react';

export type ModuleDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string;
  group: 'Editing' | 'Auditing' | 'Managing' | 'Review' | 'System';
  badge?: string;
  component: ComponentType;
};
