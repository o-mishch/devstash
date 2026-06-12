// data attribute trigger: no React ref available across component boundaries
export function triggerCreateItemButton(): void {
  document.querySelector<HTMLButtonElement>('[data-create-item-trigger]')?.click()
}
