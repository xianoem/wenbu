import { describe, expect, it } from '@effect/vitest'
import { quad } from './Quad'
import { assignDirections, mergeLines, sortBlocks, type Line } from './TextMerge'
import page from './__fixtures__/merge-page.json'

/** One editor page as the plugin saw it: the OCR's lines going into the merge, the merged regions and
 * the blocks its scan returned, plus its panels and the detector's raw lines. */
const toQuad = (pts: ReadonlyArray<ReadonlyArray<number>>) =>
  quad(
    pts.map(([x = 0, y = 0]) => ({ x, y })),
    1,
  )

const panels = page.panels.map(([x = 0, y = 0, width = 0, height = 0]) => ({ x, y, width, height }))

const theirLines: ReadonlyArray<Line> = page.merge.lines.map((line) => ({
  ...toQuad(line.pts),
  direction: line.direction === 'v' ? 'v' : 'h',
}))

const boxesOf = (blocks: ReadonlyArray<{ readonly xyxy: ReadonlyArray<number> }>) =>
  blocks.map((block) => [...block.xyxy])

describe('mergeLines', () => {
  it('merges the OCR lines into the same regions as the plugin', () => {
    const ours = mergeLines(theirLines)

    expect(
      ours.map((block) => [
        [...block.xyxy],
        block.fontSize,
        block.lines.map((line) => line.pts.map((p) => [p.x, p.y])),
      ]),
    ).toEqual(page.merge.regions.map((region) => [region.xyxy, region.fontSize, region.lines]))
  })

  it('orders the kept blocks by panel like the plugin', () => {
    const kept = mergeLines(theirLines).filter((block) =>
      page.blocks.some((box) => box.join() === block.xyxy.join()),
    )

    expect(boxesOf(sortBlocks(kept, panels, true))).toEqual(page.blocks)
  })

  it('finds the same blocks from the raw detection lines', () => {
    const native = sortBlocks(mergeLines(assignDirections(page.detected.map(toQuad))), panels, true)

    expect(boxesOf(native)).toEqual(page.blocks)
  })
})
