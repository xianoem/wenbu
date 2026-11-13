import { useAtomSet } from '@effect/atom-react'
import { CaretDownIcon, CpuIcon, MagnifyingGlassIcon, WrenchIcon } from '@phosphor-icons/react'
import { Exit } from 'effect'
import { useState } from 'react'
import type { GameProcess } from '#contract/TranslationOverlay'
import { formErrorOf } from '#lib/forms'
import { Button } from '#ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#ui/collapsible'
import { Input } from '#ui/input'
import { ScrollArea } from '#ui/scroll-area'
import { Spinner } from '#ui/spinner'
import { attachOverlayAtom, findGameProcessesAtom } from '../overlay'

function ProcessRow({
  process,
  onAttach,
}: {
  readonly process: GameProcess
  readonly onAttach: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/80 p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <CpuIcon />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {process.name}{' '}
          <span className="font-mono text-xs text-muted-foreground">pid {process.processId}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{process.matchReason}</div>
        {process.executablePath === '' ? null : (
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {process.executablePath}
          </div>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onAttach}>
        Attach
      </Button>
    </div>
  )
}

const scanLabel = (scanning: boolean, scanned: boolean) => {
  if (scanning) {
    return 'Scanning running processes…'
  }

  return scanned ? 'Scan again' : 'Find running processes'
}

export function AttachPanel({ gameId }: { readonly gameId: string | undefined }) {
  const find = useAtomSet(findGameProcessesAtom, { mode: 'promiseExit' })
  const attachTo = useAtomSet(attachOverlayAtom, { mode: 'promiseExit' })
  const [processes, setProcesses] = useState<ReadonlyArray<GameProcess> | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [manualPid, setManualPid] = useState('')

  const scan = async () => {
    if (gameId === undefined) {
      return
    }

    setScanning(true)
    setError(undefined)

    const exit = await find({ payload: { gameId } })

    setScanning(false)

    if (Exit.isSuccess(exit)) {
      setProcesses(exit.value)

      return
    }

    setError(formErrorOf(exit)?.message)
  }

  const attach = async (processId: number) => {
    if (gameId === undefined) {
      return
    }

    setError(formErrorOf(await attachTo({ payload: { gameId, processId } }))?.message)
  }

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="w-full justify-center"
        disabled={gameId === undefined || scanning}
        onClick={scan}
      >
        {scanning ? <Spinner data-icon="inline-start" /> : <MagnifyingGlassIcon />}
        {scanLabel(scanning, processes !== undefined)}
      </Button>
      {gameId === undefined ? (
        <div className="text-xs text-muted-foreground">
          Select a registered game first. Process matching is game-specific.
        </div>
      ) : null}
      {error === undefined ? null : <div className="text-xs text-destructive">{error}</div>}
      {processes !== undefined && processes.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No running process matches this game. Start it first, or attach by process ID.
        </div>
      ) : null}
      {processes === undefined || processes.length === 0 ? null : (
        <ScrollArea className="max-h-48 overflow-hidden">
          <div className="space-y-2 pr-2">
            {processes.map((process) => (
              <ProcessRow
                key={process.processId}
                process={process}
                onAttach={() => attach(process.processId)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
      <Collapsible>
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" className="w-full justify-start" />}
        >
          <WrenchIcon />
          Advanced / attach by PID
          <CaretDownIcon className="ml-auto" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="space-y-2 pr-2">
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                aria-label="Process ID"
                value={manualPid}
                placeholder="Enter process ID"
                className="font-mono"
                onChange={(event) => setManualPid(event.currentTarget.value.replaceAll(/\D/g, ''))}
              />
              <Button
                variant="outline"
                disabled={manualPid === '' || gameId === undefined}
                onClick={() => attach(Number(manualPid))}
              >
                Attach
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Attach directly to a known process ID when scanning does not surface the game.
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
