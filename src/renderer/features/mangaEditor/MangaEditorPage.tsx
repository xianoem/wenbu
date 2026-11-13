import { useAtomSet, useAtomValue } from '@effect/atom-react'
import {
  ArrowLeftIcon,
  BookOpenTextIcon,
  CaretRightIcon,
  CircleNotchIcon,
  CursorIcon,
  ExportIcon,
  HandIcon,
  ImageIcon,
  LockSimpleIcon,
  PaintBrushIcon,
  SelectionPlusIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { Effect, Exit } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import {
  type EditorPage,
  type Lettering,
  linesOf,
  type MangaEditorState,
  type PageBox,
  type TextBlock,
} from '#contract/MangaEditor'
import { formErrorOf } from '#lib/forms'
import { type PayloadOf, useCoreCall } from '#lib/rpc'
import { mangaEditorAtom } from '#lib/navigation'
import { Button } from '#ui/button'
import { Slider } from '#ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '#ui/tooltip'
import { TitleBar } from '../../shell/TitleBar'
import { BottomToolbar } from './components/BottomToolbar'
import { type ChatEntry, ChatDrawer } from './components/ChatDrawer'
import { cropPage } from './components/cropPage'
import { EmptyPanel } from './components/EmptyPanel'
import { Kbd } from './components/Kbd'
import { LayersPanel } from './components/LayersPanel'
import { type Line, lineNumbers, lineStatus } from './components/Lines'
import { BrushOverlay, LetterOverlay, OrderOverlay, ReviewOverlay } from './components/PageOverlay'
import { type FindImage, fullBitmap, pageUrl, preload } from './components/pageImages'
import { PageView, type ShownPage, type Zoom } from './components/PageView'
import { ScriptPanel } from './components/ScriptPanel'
import { bubbleLayout, fontOf, pageLayouts, sizeScale } from './lettering/bubbleLayout'
import { letteringFont, useFindFont, useLetteringFonts } from './lettering/letteringFonts'
import { TextLayer } from './lettering/TextLayer'
import {
  closeMangaEditorAtom,
  imageKey,
  letterMangaEditorBlockAtom,
  mangaEditorStateAtom,
  mergeMangaEditorLinesAtom,
  orderMangaEditorLinesAtom,
  redoMangaEditorAtom,
  removeMangaEditorBlockAtom,
  mangaEditorSettingsAtom,
  splitMangaEditorLineAtom,
  undoMangaEditorAtom,
  updateMangaEditorLineAtom,
} from './mangaEditor'

type Tool = 'select' | 'add' | 'pan' | 'brush'

type View = 'original' | 'result'

type Side = 'script' | 'layers'

const folderName = (folder: string) =>
  folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)

const allApproved = (lines: ReadonlyArray<Line>) =>
  lines.length > 0 && lines.every((line) => lineStatus(line) === 'approved')

const layersOpen = (page: EditorPage | undefined, lines: ReadonlyArray<Line>) =>
  page !== undefined && (allApproved(lines) || page.cleanVersion > 0 || page.renderVersion > 0)

const sideFor = (page: EditorPage | undefined): Side =>
  layersOpen(page, linesOf(page?.blocks ?? [])) ? 'layers' : 'script'

const firstToReview = (lines: ReadonlyArray<Line>) =>
  (lines.find((line) => lineStatus(line) !== 'approved') ?? lines[0])?.[0]?.id

const messageOf = (exit: Exit.Exit<unknown, unknown>, fallback: string) =>
  Exit.isSuccess(exit) ? undefined : (formErrorOf(exit)?.message ?? fallback)

function ToolButton({
  label,
  shortcut,
  on,
  onClick,
  children,
}: {
  readonly label: string
  readonly shortcut: string
  readonly on: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant={on ? 'secondary' : 'ghost'}
            aria-label={label}
            aria-pressed={on}
            className={cn('rounded-full', !on && 'text-muted-foreground')}
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="right">
        {label} <span className="text-muted-foreground">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  )
}

function ViewSwitch({
  view,
  available,
  onView,
}: {
  readonly view: View
  readonly available: boolean
  readonly onView: (view: View) => void
}) {
  return (
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-popover/90 p-0.5 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
      <Button
        size="xs"
        variant={view === 'original' ? 'secondary' : 'ghost'}
        className="h-7 rounded-full px-3"
        onClick={() => onView('original')}
      >
        <ImageIcon />
        Original
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <span>
              <Button
                size="xs"
                variant={view === 'result' ? 'secondary' : 'ghost'}
                className="h-7 rounded-full px-3"
                disabled={!available}
                onClick={() => onView('result')}
              >
                {available ? <SparkleIcon /> : <LockSimpleIcon />}
                Result
              </Button>
            </span>
          }
        />
        {available ? null : (
          <TooltipContent side="bottom" className="max-w-56">
            Approve every line, then clean or letter the page from its layers.
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  )
}

const shownKeyOf = (folder: string, page: EditorPage) =>
  page.cleanVersion > 0
    ? imageKey(folder, page.name, 'cleaned', page.cleanVersion)
    : imageKey(folder, page.name, 'original', 0)

function PageImage({
  imageKey: key,
  ahead,
  read,
  children,
  ...view
}: {
  readonly imageKey: string
  readonly ahead: ReadonlyArray<string>
  readonly read: FindImage
  readonly zoom: Zoom
  readonly panning: boolean
  readonly onZoom: (zoom: Zoom) => void
  readonly onScale: (scale: number) => void
  readonly children: (page: ShownPage) => ReactNode
}) {
  const [shown, setShown] = useState<{ readonly key: string; readonly url: string }>()
  const [failed, setFailed] = useState<string>()

  useEffect(() => {
    let gone = false

    pageUrl(read, key).then(
      (url) => {
        if (!gone) {
          setShown({ key, url })
          setFailed(undefined)
        }
      },
      () => {
        if (!gone) {
          setFailed(key)
        }
      },
    )

    return () => {
      gone = true
    }
  }, [key, read])

  const ready = shown?.key === key

  useEffect(() => {
    if (ready) {
      preload(read, ahead)
    }
  }, [ahead, read, ready])

  if (failed === key) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        The page could not be read.
      </div>
    )
  }

  return (
    <PageView src={shown?.url} {...view}>
      {children}
    </PageView>
  )
}

function EditorTitle({
  folder,
  page,
  exporting,
  problem,
  onBack,
  onExport,
}: {
  readonly folder: string
  readonly page: string
  readonly exporting: boolean
  readonly problem: string | undefined
  readonly onBack: () => void
  readonly onExport: () => void
}) {
  return (
    <>
      <Button
        variant="ghost"
        className="app-no-drag ml-1 h-6.5 gap-1.5 rounded-full bg-muted/50 px-2.5 text-[12px] font-semibold ring-1 ring-foreground/8"
        onClick={onBack}
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to Wenbu
        <Kbd>Ctrl [</Kbd>
      </Button>
      <div className="mx-2.5 h-4 w-px bg-sidebar-border" />
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        <BookOpenTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-muted-foreground">{folderName(folder)}</span>
        <CaretRightIcon className="size-2.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-[12px]">{page}</span>
      </span>
      <div className="min-w-4 flex-1" />
      {problem === undefined ? null : (
        <span className="app-no-drag mr-3 max-w-96 truncate text-[12px] text-destructive">
          {problem}
        </span>
      )}
      <Button
        size="xs"
        className="app-no-drag mr-2 h-6.5 rounded-full px-3"
        disabled={exporting}
        onClick={onExport}
      >
        {exporting ? <CircleNotchIcon className="animate-spin" /> : <ExportIcon />}
        Export
      </Button>
    </>
  )
}

function Workspace({
  state,
  onBack,
}: {
  readonly state: MangaEditorState
  readonly onBack: () => void
}) {
  const folder = state.folder
  const [index, setIndex] = useState(0)
  const page = state.pages[Math.min(index, state.pages.length - 1)]
  const name = page?.name ?? ''
  const lines = useMemo(() => linesOf(page?.blocks ?? []), [page])
  const numbers = lineNumbers(lines)

  const [side, setSide] = useState<Side>(sideFor(page))
  const [view, setView] = useState<View>('original')
  const [holding, setHolding] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [brushSize, setBrushSize] = useState(40)
  const settings = useAtomValue(mangaEditorSettingsAtom(folder))
  const gallerySettings = AsyncResult.isSuccess(settings) ? settings.value : undefined
  const galleryFont = gallerySettings?.font ?? ''
  const findFont = useFindFont()
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [scale, setScale] = useState(1)
  const [chosen, setChosen] = useState<string>()
  const [textShown, setTextShown] = useState(true)
  const [scriptLocked, setScriptLocked] = useState(true)
  const [cleanShown, setCleanShown] = useState(true)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [numbering, setNumbering] = useState(false)
  const [numbered, setNumbered] = useState<ReadonlyArray<string>>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [chats, setChats] = useState<ReadonlyMap<string, ReadonlyArray<ChatEntry>>>(new Map())
  const [attached, setAttached] = useState<string>()
  const [chatWaiting, setChatWaiting] = useState(false)
  const [chatProblem, setChatProblem] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const [problem, setProblem] = useState<string>()
  const textarea = useRef<HTMLTextAreaElement>(null)

  const call = useCoreCall()

  const scan = ({ payload }: { readonly payload: PayloadOf<'scanMangaEditorPage'> }) =>
    call((client) => client('scanMangaEditorPage', payload))

  const translate = ({ payload }: { readonly payload: PayloadOf<'translateMangaEditorPage'> }) =>
    call((client) => client('translateMangaEditorPage', payload))

  const clean = ({ payload }: { readonly payload: PayloadOf<'cleanMangaEditorPage'> }) =>
    call((client) => client('cleanMangaEditorPage', payload))

  const brushPage = ({ payload }: { readonly payload: PayloadOf<'brushMangaEditorPage'> }) =>
    call((client) => client('brushMangaEditorPage', payload))

  const addBlock = ({ payload }: { readonly payload: PayloadOf<'addMangaEditorBlock'> }) =>
    call((client) => client('addMangaEditorBlock', payload))

  const updateLine = useAtomSet(updateMangaEditorLineAtom)
  const letterBlock = useAtomSet(letterMangaEditorBlockAtom)
  const removeBlock = useAtomSet(removeMangaEditorBlockAtom)
  const orderLines = useAtomSet(orderMangaEditorLinesAtom)
  const mergeLines = useAtomSet(mergeMangaEditorLinesAtom)
  const splitLine = useAtomSet(splitMangaEditorLineAtom)
  const undo = useAtomSet(undoMangaEditorAtom)
  const redo = useAtomSet(redoMangaEditorAtom)

  const suggest = ({
    payload,
  }: {
    readonly payload: PayloadOf<'suggestMangaEditorAlternatives'>
  }) => call((client) => client('suggestMangaEditorAlternatives', payload))

  const chat = ({ payload }: { readonly payload: PayloadOf<'chatMangaEditor'> }) =>
    call((client) => client('chatMangaEditor', payload))

  const exportPages = ({ payload }: { readonly payload: PayloadOf<'exportMangaEditor'> }) =>
    call((client) => client('exportMangaEditor', payload))

  const find = ({ payload }: { readonly payload: PayloadOf<'findMangaEditorImage'> }) =>
    call((client) => client('findMangaEditorImage', payload))

  const selected = lines.some((line) => line.some((block) => block.id === chosen))
    ? chosen
    : firstToReview(lines)

  const lineIndex = lines.findIndex((line) => line.some((block) => block.id === selected))
  const selectedLine = lines[lineIndex]
  const empty = page !== undefined && page.blocks.length === 0 && !page.done.includes('scan')
  const unlocked = layersOpen(page, lines)
  const layered = side === 'layers' && unlocked
  const cleaned = (page?.cleanVersion ?? 0) > 0
  const resultReady = cleaned || unlocked

  const fonts = useLetteringFonts(
    gallerySettings === undefined
      ? []
      : (page?.blocks ?? []).map((block) => fontOf(block, gallerySettings)),
  )

  const showResult = view === 'result' && resultReady && !holding
  const painting = layered && tool === 'brush'

  const goTo = (next: number) => {
    const target = Math.max(0, Math.min(state.pages.length - 1, next))
    const targetPage = state.pages[target]
    const ready = (targetPage?.cleanVersion ?? 0) > 0

    setIndex(target)
    setChosen(undefined)
    setSide(sideFor(targetPage))
    setView(ready ? 'result' : 'original')
    setTool('select')
    setNumbered([])
    setNumbering(false)
    setPicked(new Set())
    setAttached(undefined)
    setProblem(undefined)
  }

  const target = (line: Line) => ({ folder, page: name, id: line[0]?.id ?? '' })

  const runPageStep = async (run: () => Promise<Exit.Exit<unknown, unknown>>, fallback: string) => {
    setProblem(undefined)
    setProblem(messageOf(await run(), fallback))
  }

  const startScan = () =>
    void runPageStep(
      () => scan({ payload: { folder, page: name, translate: true } }),
      'The page could not be scanned.',
    )

  const draw = async (box: PageBox) => {
    const read = await Effect.runPromiseExit(
      fullBitmap(find, imageKey(folder, name, 'original', 0)),
    )

    if (Exit.isFailure(read)) {
      setProblem('The page could not be read.')

      return
    }

    const original = read.value

    const exit = await addBlock({
      payload: { folder, page: name, box, image: cropPage(original, box) },
    })

    original.close()

    if (Exit.isSuccess(exit)) {
      setChosen(exit.value)
      setSide('script')
      setScriptLocked(false)
      setTool('select')
    }
  }

  const letter = (block: TextBlock, lettering: Lettering, everyBubble: boolean) =>
    letterBlock({ payload: { folder, page: name, id: block.id, lettering, everyBubble } })

  const finishNumbering = (ids: ReadonlyArray<string>) => {
    const rest = (page?.blocks ?? []).map((block) => block.id).filter((id) => !ids.includes(id))

    if (ids.length > 0) {
      orderLines({ payload: { folder, page: name, ids: [...ids, ...rest] } })
    }

    setNumbered([])
    setNumbering(false)
  }

  const number = (id: string) => {
    if (numbered.includes(id)) {
      return
    }

    const next = [...numbered, id]

    if (next.length === (page?.blocks.length ?? 0)) {
      finishNumbering(next)

      return
    }

    setNumbered(next)
  }

  const merge = () => {
    if (picked.size >= 2) {
      mergeLines({ payload: { folder, page: name, ids: [...picked] } })
      setPicked(new Set())
    }
  }

  const moveLine = (direction: 'up' | 'down') => {
    const to = direction === 'up' ? lineIndex - 1 : lineIndex + 1

    if (selectedLine === undefined || to < 0 || to >= lines.length) {
      return
    }

    const order = [...lines]

    order.splice(lineIndex, 1)
    order.splice(to, 0, selectedLine)

    orderLines({
      payload: { folder, page: name, ids: order.flatMap((line) => line.map((block) => block.id)) },
    })
  }

  const sendChat = async (text: string) => {
    const asked: ReadonlyArray<ChatEntry> = [
      ...(chats.get(name) ?? []),
      { id: crypto.randomUUID(), role: 'user', text },
    ]

    setChats(new Map(chats).set(name, asked))
    setChatWaiting(true)
    setChatProblem(undefined)

    const exit = await chat({
      payload: {
        folder,
        page: name,
        ...(attached === undefined ? {} : { id: attached }),
        messages: asked.map((entry) => ({ role: entry.role, text: entry.text })),
      },
    })

    setChatWaiting(false)

    if (Exit.isFailure(exit)) {
      setChatProblem(formErrorOf(exit)?.message ?? 'No answer came back.')

      return
    }

    const answer: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: exit.value.text,
      ...(exit.value.suggestion === undefined ? {} : { suggestion: exit.value.suggestion }),
    }

    setChats((current) => new Map(current).set(name, [...asked, answer]))
  }

  const exportAll = async () => {
    if (gallerySettings === undefined) {
      return
    }

    setExporting(true)

    const used = new Set(
      state.pages.flatMap((one) => one.blocks.map((block) => fontOf(block, gallerySettings))),
    )

    const loaded = new Map(
      await Promise.all(
        [...used].map(async (font) => [font, await letteringFont(font, findFont)] as const),
      ),
    )

    const layouts = pageLayouts(state.pages, gallerySettings, loaded)
    const exit = await exportPages({ payload: { folder, layouts } })

    setExporting(false)

    if (Exit.isSuccess(exit)) {
      window.wenbu.revealPath(exit.value)

      return
    }

    setProblem(formErrorOf(exit)?.message)
  }

  const pickTool = (next: Tool) => setTool(next)

  const step = (by: number) => setChosen(lines[Math.max(0, lineIndex + by)]?.[0]?.id ?? selected)

  const keys: Record<string, () => void> = {
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
    j: () => step(1),
    k: () => step(-1),
    Enter: () => textarea.current?.focus(),
    ']': () => goTo(index + 1),
    '[': () => goTo(index - 1),
    PageDown: () => goTo(index + 1),
    PageUp: () => goTo(index - 1),
    c: () => setChatOpen(!chatOpen),
    v: () => pickTool('select'),
    a: () => (empty ? undefined : pickTool('add')),
    h: () => pickTool(tool === 'pan' ? 'select' : 'pan'),
    b: () => (layered ? pickTool('brush') : undefined),
    s: () => (empty ? startScan() : undefined),
    m: () => merge(),
    M: () =>
      selectedLine === undefined || selectedLine.length < 2
        ? undefined
        : splitLine({ payload: target(selectedLine) }),
    Escape: () => {
      setTool('select')
      setChatOpen(false)
      setPicked(new Set())
    },
    ' ': () => setHolding(true),
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isTyping(event.target)) {
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key === '[') {
      event.preventDefault()
      onBack()

      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()

      if (event.shiftKey) {
        redo({ payload: { folder, page: name } })
      } else {
        undo({ payload: { folder, page: name } })
      }

      return
    }

    if (event.ctrlKey || event.metaKey) {
      return
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      moveLine(event.key === 'ArrowUp' ? 'up' : 'down')

      return
    }

    const run = keys[event.key]

    if (run !== undefined) {
      event.preventDefault()
      run()
    }
  })

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKeyDown(event)

    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        setHolding(false)
      }
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const title = (
    <TitleBar>
      <EditorTitle
        folder={folder}
        page={name}
        exporting={exporting}
        problem={problem}
        onBack={onBack}
        onExport={() => void exportAll()}
      />
    </TitleBar>
  )

  if (page === undefined) {
    return title
  }

  const original = imageKey(folder, name, 'original', 0)

  const shownKey =
    showResult && cleanShown && cleaned
      ? imageKey(folder, name, 'cleaned', page.cleanVersion)
      : original

  const ahead = [state.pages[index + 1], state.pages[index - 1]]
    .filter((near) => near !== undefined)
    .map((near) => shownKeyOf(folder, near))

  const overlay = (shown: ShownPage) => (
    <>
      {showResult && textShown && gallerySettings !== undefined ? (
        <TextLayer
          page={shown}
          pageHeight={page.height}
          blocks={page.blocks}
          settings={gallerySettings}
          fonts={fonts}
        />
      ) : null}
      {interaction(shown)}
    </>
  )

  const interaction = (shown: ShownPage) => {
    if (empty) {
      return null
    }

    if (numbering) {
      return (
        <OrderOverlay page={shown} blocks={page.blocks} numbered={numbered} onNumber={number} />
      )
    }

    if (painting) {
      return (
        <BrushOverlay
          page={shown}
          brushSize={brushSize}
          onStroke={async (image) => {
            setProblem(
              messageOf(
                await brushPage({ payload: { folder, page: name, image } }),
                'The brushed area could not be cleaned.',
              ),
            )
          }}
        />
      )
    }

    if (layered && tool === 'select') {
      return (
        <LetterOverlay
          page={shown}
          blocks={page.blocks}
          selected={selected}
          onSelect={(id) => setChosen(id)}
          onMove={(block, box) => letter(block, { ...block.lettering, textBox: box }, false)}
        />
      )
    }

    return (
      <ReviewOverlay
        page={shown}
        lines={lines}
        selected={selected}
        drawing={tool === 'add'}
        onSelect={(id) => setChosen(id)}
        onDraw={(box) => void draw(box)}
      />
    )
  }

  const attachedIndex = lines.findIndex((line) => line.some((block) => block.id === attached))

  const approve = (line: Line, translation: string | undefined, approved: boolean) => {
    updateLine({
      payload: { ...target(line), approved, ...(translation === undefined ? {} : { translation }) },
    })

    if (!approved) {
      return
    }

    const others = lines.filter((candidate) => candidate !== line)

    const next = lines
      .slice(lineIndex + 1)
      .find((candidate) => lineStatus(candidate) !== 'approved')

    if (others.every((candidate) => lineStatus(candidate) === 'approved')) {
      setSide('layers')
      setChosen(lines[0]?.[0]?.id)

      return
    }

    setChosen(next?.[0]?.id ?? firstToReview(others) ?? line[0]?.id)
  }

  const tools: ReadonlyArray<{
    readonly tool: Tool
    readonly label: string
    readonly shortcut: string
    readonly icon: ReactNode
  }> = [
    { tool: 'select', label: 'Select', shortcut: 'V', icon: <CursorIcon /> },
    { tool: 'add', label: 'Add text the scan missed', shortcut: 'A', icon: <SelectionPlusIcon /> },
    ...(layered
      ? [
          {
            tool: 'brush' as const,
            label: 'Brush leftovers away',
            shortcut: 'B',
            icon: <PaintBrushIcon />,
          },
        ]
      : []),
    { tool: 'pan', label: 'Pan', shortcut: 'H', icon: <HandIcon /> },
  ]

  return (
    <>
      {title}
      <div className="flex min-h-0 flex-1 border-t">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <ViewSwitch
            view={showResult ? 'result' : 'original'}
            available={resultReady}
            onView={setView}
          />
          {empty ? null : (
            <div className="absolute top-3 left-3 z-10 flex flex-col items-center gap-0.5 rounded-full bg-popover/90 p-0.5 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
              {tools.map((entry) => (
                <ToolButton
                  key={entry.tool}
                  label={entry.label}
                  shortcut={entry.shortcut}
                  on={tool === entry.tool}
                  onClick={() =>
                    pickTool(tool === entry.tool && entry.tool !== 'select' ? 'select' : entry.tool)
                  }
                >
                  {entry.icon}
                </ToolButton>
              ))}
            </div>
          )}
          {painting ? (
            <div className="absolute top-3 left-14 z-10 flex h-9 items-center gap-2.5 rounded-full bg-popover/90 px-3.5 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
              <span className="text-[12px] text-muted-foreground">Brush</span>
              <Slider
                aria-label="Brush size"
                value={[brushSize]}
                min={4}
                max={200}
                onValueChange={(value) =>
                  setBrushSize(Array.isArray(value) ? (value[0] ?? brushSize) : value)
                }
                className="w-32"
              />
              <span className="w-8 text-right font-mono text-[11.5px]">{brushSize}</span>
            </div>
          ) : null}
          <PageImage
            imageKey={shownKey}
            ahead={ahead}
            read={find}
            zoom={zoom}
            panning={tool === 'pan'}
            onZoom={setZoom}
            onScale={setScale}
          >
            {overlay}
          </PageImage>
          {chatOpen ? (
            <ChatDrawer
              pageNumber={index + 1}
              attached={attachedIndex === -1 ? undefined : numbers[attachedIndex]}
              entries={chats.get(name) ?? []}
              waiting={chatWaiting}
              problem={chatProblem}
              onDetach={() => setAttached(undefined)}
              onSend={(text) => void sendChat(text)}
              onUse={(suggestion) =>
                updateLine({
                  payload: {
                    folder,
                    page: name,
                    id: suggestion.id,
                    translation: suggestion.translation,
                  },
                })
              }
              onClose={() => setChatOpen(false)}
            />
          ) : null}
        </div>
        <div className="flex w-93 shrink-0 flex-col overflow-hidden border-l bg-background">
          {empty ? <EmptyPanel page={page} onScan={startScan} /> : null}
          {!empty && !layered ? (
            <ScriptPanel
              page={page}
              lines={lines}
              selected={selected}
              picked={picked}
              numbering={numbering}
              layers={unlocked}
              locked={unlocked && scriptLocked}
              onUnlock={() => setScriptLocked(false)}
              textarea={textarea}
              onSelect={setChosen}
              onPick={setPicked}
              onOrder={(ids) => orderLines({ payload: { folder, page: name, ids } })}
              onMerge={merge}
              onNumbering={(on) => (on ? setNumbering(true) : finishNumbering(numbered))}
              onTranslate={() =>
                void runPageStep(
                  () => translate({ payload: { folder, page: name } }),
                  'The page could not be translated.',
                )
              }
              onLayers={() => setSide('layers')}
              actions={{
                save: (line, translation) =>
                  updateLine({ payload: { ...target(line), translation } }),
                approve,
                setKind: (line, kind) => updateLine({ payload: { ...target(line), kind } }),
                split: (line) => splitLine({ payload: target(line) }),
                remove: (line) => {
                  for (const block of line) {
                    removeBlock({ payload: { folder, page: name, id: block.id } })
                  }
                },
                alternatives: async (line) => {
                  const exit = await suggest({ payload: target(line) })

                  return Exit.isSuccess(exit)
                    ? exit.value
                    : (formErrorOf(exit)?.message ?? 'No alternatives came back.')
                },
                ask: (line) => {
                  setAttached(line[0]?.id)
                  setChatOpen(true)
                },
              }}
            />
          ) : null}
          {!empty && layered ? (
            <LayersPanel
              page={page}
              lines={lines}
              selected={selected}
              galleryFont={galleryFont}
              sizing={{
                kindSizes: gallerySettings?.kindSizes ?? {},
                scale: gallerySettings === undefined ? 1 : sizeScale(gallerySettings, page.height),
              }}
              textShown={textShown}
              cleanShown={cleanShown}
              onSelect={setChosen}
              onTextShown={(shown) => {
                setTextShown(shown)
                setView('result')
              }}
              onCleanShown={(shown) => {
                setCleanShown(shown)
                setView('result')
              }}
              onScript={() => {
                setScriptLocked(true)
                setSide('script')
              }}
              actions={{
                saveLine: (line, translation) =>
                  updateLine({ payload: { ...target(line), translation } }),
                letter,
                layout: (block, lettering, share) =>
                  gallerySettings === undefined
                    ? undefined
                    : bubbleLayout(
                        block,
                        gallerySettings,
                        fonts.get(fontOf(block, gallerySettings)),
                        page.height,
                        lettering,
                        share,
                      ),
                cleanPage: () =>
                  void runPageStep(async () => {
                    const exit = await clean({ payload: { folder, page: name } })

                    if (Exit.isSuccess(exit)) {
                      setView('result')
                      setCleanShown(true)
                    }

                    return exit
                  }, 'The page could not be cleaned.'),
              }}
            />
          ) : null}
        </div>
      </div>
      <BottomToolbar
        folder={folder}
        pages={state.pages}
        index={index}
        usage={state.usage}
        chat={chatOpen}
        canUndo={page.canUndo}
        canRedo={page.canRedo}
        zoom={zoom}
        scale={scale}
        onChat={() => setChatOpen(!chatOpen)}
        onPage={goTo}
        onUndo={() => undo({ payload: { folder, page: name } })}
        onRedo={() => redo({ payload: { folder, page: name } })}
        onZoom={setZoom}
      />
    </>
  )
}

export function MangaEditorPage({ folder }: { readonly folder: string }) {
  const state = useAtomValue(mangaEditorStateAtom(folder))
  const setEditing = useAtomSet(mangaEditorAtom)
  const close = useAtomSet(closeMangaEditorAtom)

  const back = () => {
    close({ payload: { folder } })
    setEditing(undefined)
  }

  if (AsyncResult.isSuccess(state) && state.value.pages.length > 0) {
    return <Workspace state={state.value} onBack={back} />
  }

  return (
    <>
      <TitleBar>
        <Button
          variant="ghost"
          className="app-no-drag ml-1 h-6.5 gap-1.5 rounded-full bg-muted/50 px-2.5 text-[12px] font-semibold"
          onClick={back}
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to Wenbu
        </Button>
      </TitleBar>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 border-t text-muted-foreground">
        {AsyncResult.isFailure(state) ? (
          <p>
            {formErrorOf(Exit.failCause(state.cause))?.message ??
              'The gallery could not be opened.'}
          </p>
        ) : (
          <span className="flex items-center gap-2">
            <CircleNotchIcon className="size-4 animate-spin" />
            Opening the gallery…
          </span>
        )}
      </div>
    </>
  )
}
