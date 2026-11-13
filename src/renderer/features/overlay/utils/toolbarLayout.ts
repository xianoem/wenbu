export type OverlayTool = 'retry' | 'original' | 'textStyle' | 'opacity'

const priority: ReadonlyArray<OverlayTool> = ['retry', 'original', 'textStyle', 'opacity']

export const toolbarWidths = {
  fixed: 32 + 16 + 120 + 2 * 34,
  button: 34,
  opacity: 150,
} as const

const widthOf = (tool: OverlayTool) =>
  tool === 'opacity' ? toolbarWidths.opacity : toolbarWidths.button

const total = (tools: ReadonlyArray<OverlayTool>) =>
  tools.reduce((sum, tool) => sum + widthOf(tool), 0)

export const toolbarLayout = (headerWidth: number) => {
  const room = headerWidth - toolbarWidths.fixed

  if (total(priority) <= room) {
    return { inline: priority, overflow: [] }
  }

  const withMenu = room - toolbarWidths.button
  const inline: Array<OverlayTool> = []

  for (const tool of priority) {
    if (total([...inline, tool]) > withMenu) {
      break
    }

    inline.push(tool)
  }

  return { inline, overflow: priority.slice(inline.length) }
}
