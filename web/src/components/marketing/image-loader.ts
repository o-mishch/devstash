export async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.addEventListener('load', (): void => resolve(img))
    img.addEventListener('error', (): void => resolve(null))
    img.src = dataUrl
  })
}
