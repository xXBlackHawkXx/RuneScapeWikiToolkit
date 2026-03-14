# Module Blueprint

Use this recipe for any new module.

1. Create `src/modules/<moduleName>/index.tsx`.
2. Build UI from shared `Panel`, `Field`, `Button`, `QueuePanel`.
3. Pull dependencies from `useAppContext()`.
4. Put MediaWiki calls behind `wiki.*` methods.
5. If the module is bulk-oriented, enqueue a job rather than looping directly in the click handler.
6. Export a `ModuleDefinition` object.
7. Add it to `src/core/modules/registry.ts`.
