# RS3 Wiki Toolkit

A Vite + React + TypeScript rewrite of the original wireframe, with real MediaWiki Action API plumbing, a pause/resume job queue for bulk work, and a module registry that keeps future tools easy to add.

## What is included

- Real MediaWiki login, token, query, compare, search, category, and edit flows
- Generic job queue with `pause`, `resume`, `cancel`, `clear`
- Module registry for easy future module registration
- Agents folder with scaffolding and architectural guidance for IDE agents
- Client-side persistence for settings and logs

## Quick start

```bash
npm install
npm run dev
```

## Notes

This is a browser-first toolkit. For authenticated edits, the target wiki must allow the relevant cross-origin requests from your local dev origin. If it does not, run the app behind a small local proxy or deploy it from an allowed origin.

Use bot passwords for login. MediaWiki's login/edit flow requires a login token first, then login, then a CSRF token for edit operations.
