# Current Feature

Refactor and consolidate single-use and duplicated hooks in `src/hooks`.

## Status
Completed

## Goals
- Collapse single-use hooks (`useExplainCode`, `useOptimizePrompt`, `useGlobalSearchShortcuts`, `useAutoFetchNextPage`, `useSelectTouchSwipe`, `useActionStateWithToast`) into their callers/components.
- Group `useRestrictedAction` and `useRestrictedDownload` into `use-restricted.ts`.
- Ensure all tests and lints pass.

## Notes
Refactor cleanup based on `refactor-scanner.md` scanning findings.

