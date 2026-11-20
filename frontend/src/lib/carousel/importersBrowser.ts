// Carousel Creator - the browser half of importing: turning an SVG file into a PNG picture on a canvas. (An SVG loaded as an <img> runs no scripts and loads nothing from the internet.)
import { inspectSvg, svgRasterSize } from './importers'

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('The browser could not read that SVG. It may be damaged or use features browsers do not support.'))
  img.src = url
})

export async function svgFileToPng(file: File): Promise<{ file: File; warnings: string[] }> {
  const text = await file.text()
  const info = inspectSvg(text)
  const size = svgRasterSize(info)
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot draw on a canvas, so the SVG cannot be converted.')
    ctx.drawImage(img, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('The SVG could not be converted to a picture.')
    return { file: new File([blob], `${file.name.replace(/\.svg$/i, '') || 'image'}.png`, { type: 'image/png' }), warnings: info.warnings }
  } finally { URL.revokeObjectURL(url) }
}
