# System Brief

The app is a browser-based RS3 wiki toolkit built on Vite + React + TypeScript.

Core rules:

- Keep each module in its own folder with a single `index.tsx` entry.
- Register new modules only in `src/core/modules/registry.ts`.
- Reuse `MediaWikiClient` for API access rather than scattering raw fetch calls.
- Use the shared queue for multi-page work.
- Put parsing or text transforms in `src/core/utils` if reusable.
- Persist only settings and logs by default.
