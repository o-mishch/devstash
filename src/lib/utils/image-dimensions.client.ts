export interface ImageDimensions {
  width: number
  height: number
}

export async function getImageDimensionsFromFile(file: File): Promise<ImageDimensions | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dimensions
  } catch {
    return null
  }
}

export function probeImageDimensionsFromUrl(url: string): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => resolve(null)
    image.src = url
  })
}
