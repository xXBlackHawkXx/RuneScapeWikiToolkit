# Quality Checklist

Before considering a task done:

- TypeScript compiles without `any` leaks where avoidable.
- No duplicated raw MediaWiki login/edit logic outside the client.
- Bulk jobs pause and resume cleanly.
- Dry run does not write edits.
- Edit summaries include the shared prefix.
- New module is discoverable from the registry.
- Reusable logic moved out of the feature component.
