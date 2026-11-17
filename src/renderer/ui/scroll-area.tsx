import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import type { ComponentProps } from 'react'
import { cn } from 'cn'

const viewportSelector = '[data-slot="scroll-area-viewport"]'

function ScrollArea({
  className,
  children,
  viewport,
  contentClassName,
  scrollbars = 'vertical',
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  readonly viewport?: ComponentProps<'div'>
  readonly contentClassName?: string
  readonly scrollbars?: 'vertical' | 'horizontal' | 'both'
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        {...viewport}
        className={cn(
          'size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1',
          viewport?.className,
        )}
      >
        {/* Base UI only re-measures overflow when Content resizes; its fit-content minimum would stop vertical-only lists from truncating text. */}
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          className={cn('min-h-full', scrollbars === 'vertical' && 'min-w-0!', contentClassName)}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {scrollbars === 'horizontal' ? null : <ScrollBar />}
      {scrollbars === 'vertical' ? null : <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

const closestScrollViewport = (element: Element) => element.closest<HTMLElement>(viewportSelector)

export { ScrollArea, ScrollBar, closestScrollViewport }
