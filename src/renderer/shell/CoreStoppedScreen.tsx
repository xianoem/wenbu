import { ArrowsClockwiseIcon, ExportIcon, FolderOpenIcon, PlugsIcon } from '@phosphor-icons/react'
import type { CoreStopped } from '#contract/CoreStopped'
import { Button } from '#ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/empty'

const describe = ({ crashes, withinMillis, exitCode }: CoreStopped) =>
  `${crashes} crashes in ${Math.max(1, Math.round(withinMillis / 1000))} s · exit code ${exitCode}`

export function CoreStoppedScreen({ stopped }: { readonly stopped: CoreStopped }) {
  return (
    <main className="flex min-h-0 flex-1 border-t border-sidebar-border bg-background">
      <Empty className="gap-5">
        <EmptyHeader className="max-w-[420px]">
          <EmptyMedia className="mb-3 size-12 rounded-[14px] bg-muted text-muted-foreground [&_svg]:size-6">
            <PlugsIcon />
          </EmptyMedia>
          <EmptyTitle className="text-xl font-semibold">Wenbu stopped working</EmptyTitle>
          <EmptyDescription>
            Its background service crashed several times in a row, so Wenbu stopped restarting it.
            Your library and settings are safe.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button size="lg" className="rounded-full px-4" onClick={() => window.wenbu.relaunch()}>
            <ArrowsClockwiseIcon />
            Restart Wenbu
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="rounded-full px-4"
            onClick={() => void window.wenbu.exportDiagnostics()}
          >
            <ExportIcon />
            Export diagnostics
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="rounded-full px-3 text-muted-foreground"
            onClick={() => window.wenbu.openLogsFolder()}
          >
            <FolderOpenIcon />
            Logs folder
          </Button>
        </EmptyContent>
        <p className="font-mono text-xs text-muted-foreground">{describe(stopped)}</p>
      </Empty>
    </main>
  )
}
