You are adding a new module to the RS3 Wiki Toolkit.

Constraints:
- Vite + React + TypeScript only.
- One folder per module under `src/modules`.
- Register the module in `src/core/modules/registry.ts`.
- Shared MediaWiki access goes through `src/core/mediawiki/client.ts`.
- Shared bulk operations go through the queue.
- Reuse shared UI components before creating new ones.

Deliverables:
1. New module folder.
2. Any small reusable helpers extracted to core/shared.
3. Registry update.
4. Brief note describing API calls used and whether the module supports dry run.
