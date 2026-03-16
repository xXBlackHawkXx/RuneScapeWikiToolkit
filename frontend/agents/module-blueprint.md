# Module Blueprint

Use this recipe for any new module.

1. Create `src/modules/<moduleName>/index.tsx`.
2. Keep all module specific logic within the `src/modules/<moduleName>` directory.
3. Build UI from shared `Panel`, `Field`, `Button`, `QueuePanel`.
4. Pull dependencies from `useAppContext()`.
5. Put MediaWiki calls behind `wiki.*` methods.
6. If the module is bulk-oriented, enqueue a job rather than looping directly in the click handler.
7. Export a `ModuleDefinition` object.
8. Add it to `src/core/modules/registry.ts`.
