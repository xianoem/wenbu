import { useAtom } from '@effect/atom-react'
import { type Icon, MinusIcon, SidebarSimpleIcon, SquareIcon, XIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { WindowAction } from '#contract/WindowAction'
import { sidebarOpenAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { ThemeMenu } from '../features/appearance/ThemeMenu'
import { LogsPopover } from '../features/diagnostics/LogsPopover'

const controls = [
  { action: 'minimize', label: 'Minimize', Icon: MinusIcon },
  { action: 'maximize', label: 'Maximize', Icon: SquareIcon },
  { action: 'close', label: 'Close', Icon: XIcon },
] as const satisfies ReadonlyArray<{ action: WindowAction; label: string; Icon: Icon }>

export function TitleBar({
  logs = true,
  children,
}: {
  readonly logs?: boolean
  readonly children?: ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom)

  return (
    <header className="app-drag flex h-9 shrink-0 items-center px-1.5">
      {children ?? <SidebarToggle open={sidebarOpen} onOpen={setSidebarOpen} />}
      <div className="app-no-drag ml-auto flex items-center gap-0.5">
        {logs ? <LogsPopover /> : null}
        <ThemeMenu />
        <div aria-hidden className="mx-1.5 h-4 w-px bg-sidebar-border" />
        {controls.map(({ action, label, Icon }) => (
          <Button
            key={action}
            variant="ghost"
            size="icon"
            aria-label={label}
            className={
              action === 'close'
                ? 'h-8 w-10 hover:bg-destructive hover:text-white'
                : 'h-8 w-10 text-muted-foreground'
            }
            onClick={() => window.wenbu.window(action)}
          >
            <Icon />
          </Button>
        ))}
      </div>
    </header>
  )
}

function SidebarToggle({
  open,
  onOpen,
}: {
  readonly open: boolean
  readonly onOpen: (open: boolean) => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
      aria-pressed={open}
      title={open ? 'Hide sidebar' : 'Show sidebar'}
      className="app-no-drag ml-1.5 size-7 text-muted-foreground"
      onClick={() => onOpen(!open)}
    >
      <SidebarSimpleIcon />
    </Button>
  )
}
