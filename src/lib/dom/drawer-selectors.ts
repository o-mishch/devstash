// CSS attribute selector for the portaled right-side Sheet content element. One source of truth so
// the rail sync loop (drawer-shell) and the swipe hook (use-swipe-to-dismiss) stay in sync if
// shadcn changes the data attribute name. Lives in lib/dom (not the drawer-shared component module)
// so the swipe hook can read it without a hook→component import.
export const SHEET_CONTENT_SELECTOR = '[data-slot="sheet-content"][data-side="right"]'
