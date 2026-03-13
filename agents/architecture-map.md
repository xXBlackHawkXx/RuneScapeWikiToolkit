# Architecture Map

## Runtime layers

- `src/app/*` — global app state and providers
- `src/core/mediawiki/*` — MediaWiki Action API integration
- `src/core/queue/*` — pause/resume/cancel queue engine
- `src/core/modules/*` — module registration and metadata
- `src/modules/*` — feature modules
- `src/shared/*` — reusable UI components and layout

## Bulk operation pattern

1. Resolve titles.
2. Enqueue one queue job.
3. Iterate pages inside the queue job.
4. Respect `waitIfPaused()` and `signal`.
5. Update progress with `reportProgress()`.
6. Write logs through `addLog()`.
