import type { ModuleDefinition } from './types';
import { FindReplaceModule } from '@/modules/findReplace';
import { MassEditModule } from '@/modules/massEdit';
import { ComponentGeneratorModule } from '@/modules/componentGenerator';
import { TemplateInspectorModule } from '@/modules/templateInspector';
import { CategoryManagerModule } from '@/modules/categoryManager';
import { DeadLinkScannerModule } from '@/modules/deadLinkScanner';
import { PageDiffModule } from '@/modules/pageDiff';
import { ActionLogModule } from '@/modules/actionLog';
import { SettingsModule } from '@/modules/settings';
import { DoubleRedirectResolverModule } from '@/modules/doubleRedirectResolver';
import { PatchNoteParserModule } from '@/modules/patchNoteParser';

class ModuleRegistry {
  constructor(private readonly modules: ModuleDefinition[]) {}

  getAll() {
    return this.modules;
  }

  getById(id: string) {
    return this.modules.find((module) => module.id === id);
  }

  getGroups() {
    return ['Editing', 'Auditing', 'Managing', 'Review', 'System'].map((group) => ({
      name: group,
      items: this.modules.filter((module) => module.group === group),
    }));
  }
}

export const moduleRegistry = new ModuleRegistry([
  FindReplaceModule,
  MassEditModule,
  ComponentGeneratorModule,
  TemplateInspectorModule,
  CategoryManagerModule,
  DoubleRedirectResolverModule,
  DeadLinkScannerModule,
  PageDiffModule,
  PatchNoteParserModule,
  ActionLogModule,
  SettingsModule,
]);
