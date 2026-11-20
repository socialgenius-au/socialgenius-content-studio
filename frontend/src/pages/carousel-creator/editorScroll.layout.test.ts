import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Layout contract for the editor's three panels on wide screens (xl). A browser measurement of the real layout was done for this fix (1920x1080 down to 1280x600, tablet and phone);
// this test keeps the classes that make it work from being changed back by accident, because node cannot measure layout.
const here = __dirname
const read = (rel: string) => readFileSync(join(here, rel), 'utf8')

describe('editor panels scroll on their own (wide layout)', () => {
  const page = read('CarouselCreatorPage.tsx')
  const film = read('components/Filmstrip.tsx')
  const stage = read('components/StageCanvas.tsx')

  it('the editor owns a bounded height, and the three-panel grid fills what is left under any banner', () => {
    expect(page).toContain('data-testid="carousel-editor"')
    expect(page).toMatch(/flex flex-col gap-3 xl:h-\[calc\(100dvh-[\d.]+rem\)\] xl:min-h-\[\d+px\]" data-testid="carousel-editor"/)
    expect(page).toMatch(/className="grid [^"]*xl:min-h-0 xl:flex-1 [^"]*xl:grid-rows-\[minmax\(0,1fr\)\]"/)
    expect(page).not.toMatch(/xl:h-\[calc\(100vh-11rem\)\]/)            // the old fixed height that pushed the panels below the fold on short or zoomed windows
    expect(page).not.toContain('xl:min-h-[560px]')
  })

  it('the left slide list scrolls on its own: a flex chain with no percentage heights, and a scrolling list', () => {
    expect(page).toMatch(/order-2 min-h-0 xl:order-none xl:flex xl:flex-col"><Filmstrip/)
    expect(film).toMatch(/data-testid="filmstrip" className="[^"]*min-h-0[^"]*xl:flex-1"/)
    expect(film).not.toMatch(/data-testid="filmstrip" className="[^"]*xl:h-full/)
    expect(film).toMatch(/data-testid="slide-list"/)
    expect(film).toMatch(/className="flex min-h-0 flex-1 [^"]*xl:overflow-y-auto[^"]*"\s+data-testid="slide-list"/)
  })

  it('the centre stage scrolls when its content is larger than the space and keeps the canvas centred when it fits', () => {
    expect(stage).toMatch(/data-testid="stage"\s+className="flex [^"]*xl:min-h-0 xl:overflow-auto"/)
    expect(stage).not.toMatch(/data-testid="stage"\s+className="[^"]*justify-center/)   // justify/items-center clip the top and left of an oversized child; m-auto does not
    expect(stage).toMatch(/data-testid="stage-canvas"[^>]*\n?\s*data-slide-id[^>]*\n?\s*data-box-width[^>]*\n?\s*data-box-height[^>]*\n?\s*className="[^"]*\bm-auto\b[^"]*\bshrink-0\b/)
  })

  it('the right panel keeps its own vertical scrolling', () => {
    expect(page).toMatch(/<aside className="[^"]*xl:h-full xl:overflow-y-auto" aria-label="Editor panels">/)
  })
})
