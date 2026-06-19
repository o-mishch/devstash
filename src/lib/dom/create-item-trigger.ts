// data attribute trigger: no React ref available across component boundaries
export function triggerCreateItemButton(): void {
  if (typeof document !== 'undefined') {
    document.querySelector<HTMLButtonElement>('[data-create-item-trigger]')?.click()
  }
}
