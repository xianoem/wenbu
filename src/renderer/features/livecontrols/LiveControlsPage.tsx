import { useAtomSet, useAtomValue } from '@effect/atom-react'
import { CompassIcon, XIcon } from '@phosphor-icons/react'
import { AsyncResult } from 'effect/reactivity'
import { useEffect, useState } from 'react'
import type { GameFact } from '#contract/GameGuide'
import type { LiveControlsState } from '#contract/LiveControls'
import { Alert, AlertDescription, AlertTitle } from '#ui/alert'
import { Badge } from '#ui/badge'
import { Button } from '#ui/button'
import { ScrollArea } from '#ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/tabs'
import { ActorsTab } from './components/ActorsTab'
import { FinderPalette } from './components/FinderPalette'
import { GeneralTab } from './components/GeneralTab'
import { GuideTab, type GuideView } from './components/GuideTab'
import { useGuideAsk } from './hooks/useGuide'
import { InventoryTab } from './components/InventoryTab'
import { SwitchesVariablesTab } from './components/SwitchesVariablesTab'
import { liveControlsAtom, retryLiveControlsAtom } from './liveControls'

function Disconnected({ state }: { readonly state: LiveControlsState }) {
  const retry = useAtomSet(retryLiveControlsAtom)

  return (
    <div className="p-4">
      <ScrollArea className="h-[396px] rounded-2xl">
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </ScrollArea>
      <Button
        className="mt-3"
        disabled={!state.canRetry}
        onClick={() => retry({ payload: undefined })}
      >
        Retry
      </Button>
    </div>
  )
}

function Connected({ state }: { readonly state: LiveControlsState }) {
  const [tab, setTab] = useState('general')
  const [finding, setFinding] = useState(false)
  const [guideView, setGuideView] = useState<GuideView>('answers')
  const [picked, setPicked] = useState<GameFact>()
  const guide = useGuideAsk()

  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setFinding(true)
      }
    }

    window.addEventListener('keydown', open)

    return () => window.removeEventListener('keydown', open)
  }, [])

  const showInGuide = (fact: GameFact) => {
    setPicked(fact)
    setGuideView('picked')
    setTab('guide')
  }

  const askInGuide = (question: string) => {
    setGuideView('answers')
    setTab('guide')
    void guide.ask(question)
  }

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-h-0 flex-1">
      <TabsList className="mx-4 mt-3 w-auto">
        <TabsTrigger value="general" className="flex-auto">
          General
        </TabsTrigger>
        <TabsTrigger value="actors" className="flex-auto">
          Actors
        </TabsTrigger>
        <TabsTrigger value="inventory" className="flex-auto">
          Inventory
        </TabsTrigger>
        <TabsTrigger value="switches" className="flex-auto">
          Switches & Variables
        </TabsTrigger>
        <TabsTrigger value="guide" className="flex-auto">
          <CompassIcon />
          Guide
        </TabsTrigger>
      </TabsList>
      <FinderPalette
        open={finding}
        onOpenChange={setFinding}
        onPick={showInGuide}
        onAsk={askInGuide}
      />
      {state.ready ? null : (
        <Alert className="mx-4 mt-3 w-auto">
          <AlertTitle>Waiting for a save</AlertTitle>
          <AlertDescription>
            Start a new game or load a save, then the controls apply to it.
          </AlertDescription>
        </Alert>
      )}
      <TabsContent value="general" className="min-h-0 overflow-auto">
        <GeneralTab state={state} />
      </TabsContent>
      <TabsContent value="actors" className="min-h-0 overflow-hidden">
        <ActorsTab />
      </TabsContent>
      <TabsContent value="inventory" className="min-h-0 overflow-hidden">
        <InventoryTab />
      </TabsContent>
      <TabsContent value="switches" className="min-h-0 overflow-hidden">
        <SwitchesVariablesTab />
      </TabsContent>
      <TabsContent value="guide" className="min-h-0 overflow-hidden">
        <GuideTab
          guide={guide}
          view={guideView}
          onView={setGuideView}
          picked={picked}
          onFind={() => setFinding(true)}
        />
      </TabsContent>
    </Tabs>
  )
}

function Body({ state }: { readonly state: LiveControlsState }) {
  if (state.status === 'disconnected') {
    return <Disconnected state={state} />
  }

  if (state.status === 'connected') {
    return <Connected state={state} />
  }

  return (
    <div className="p-4">
      <Alert>
        <AlertTitle>Connecting to the game</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    </div>
  )
}

function LiveControls({ state }: { readonly state: LiveControlsState }) {
  return (
    <main className="h-screen overflow-hidden bg-transparent">
      <section className="flex h-full flex-col overflow-hidden rounded-3xl border bg-background/95 shadow-2xl backdrop-blur-xl">
        <header className="app-drag flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {state.gameTitle ?? 'Live Game Controls'}
            </div>
            <div className="truncate text-xs text-muted-foreground">{state.message}</div>
          </div>
          <Badge variant={state.status === 'disconnected' ? 'destructive' : 'secondary'}>
            {state.status}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close Live Game Controls"
            className="app-no-drag"
            onClick={() => window.wenbu.window('close')}
          >
            <XIcon />
          </Button>
        </header>
        <Body state={state} />
      </section>
    </main>
  )
}

export function LiveControlsPage() {
  const result = useAtomValue(liveControlsAtom)

  return AsyncResult.isSuccess(result) ? <LiveControls state={result.value} /> : null
}
