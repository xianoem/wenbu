import { useAtom } from '@effect/atom-react'
import { TextAaIcon } from '@phosphor-icons/react'
import { cn } from 'cn'
import { Button } from '#ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '#ui/popover'
import { Slider } from '#ui/slider'
import { Switch } from '#ui/switch'
import { type ReaderDisplay, readerDisplayAtom } from '../novels'

export const themes: Record<
  ReaderDisplay['theme'],
  { readonly background: string; readonly swatch: string; readonly label: string }
> = {
  dark: {
    background: 'bg-[oklch(0.11_0.004_285.823)]',
    swatch: 'bg-[oklch(0.11_0.004_285)]',
    label: 'Dark',
  },
  black: { background: 'bg-black', swatch: 'bg-black', label: 'Black' },
  sepia: {
    background: 'bg-[oklch(0.22_0.025_70)]',
    swatch: 'bg-[oklch(0.27_0.03_70)]',
    label: 'Sepia',
  },
}

const widths: ReadonlyArray<{ readonly width: ReaderDisplay['width']; readonly label: string }> = [
  { width: 'narrow', label: 'Narrow' },
  { width: 'comfortable', label: 'Comfortable' },
  { width: 'wide', label: 'Wide' },
]

const fonts: ReadonlyArray<{ readonly font: ReaderDisplay['font']; readonly label: string }> = [
  { font: 'serif', label: 'Serif' },
  { font: 'sans', label: 'Sans' },
]

const themeOrder: ReadonlyArray<ReaderDisplay['theme']> = ['dark', 'black', 'sepia']

function ThemeSwatch({
  theme,
  active,
  onPick,
}: {
  readonly theme: ReaderDisplay['theme']
  readonly active: boolean
  readonly onPick: () => void
}) {
  return (
    <Button
      variant="ghost"
      aria-label={themes[theme].label}
      aria-pressed={active}
      className={cn(
        'size-6 rounded-full p-0 hover:opacity-90',
        themes[theme].swatch,
        active ? 'ring-2 ring-foreground/70' : 'ring-1 ring-border',
      )}
      onClick={onPick}
    />
  )
}

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Segments<A extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string
  readonly options: ReadonlyArray<{ readonly value: A; readonly label: string }>
  readonly value: A
  readonly onChange: (value: A) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-0.5 rounded-full bg-secondary p-0.5"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          variant="ghost"
          className={cn(
            'h-6 rounded-full px-2.5 text-xs font-normal',
            option.value === value
              ? 'bg-background shadow-card hover:bg-background'
              : 'text-muted-foreground',
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

export function DisplayPopover() {
  const [display, setDisplay] = useAtom(readerDisplayAtom)
  const change = (fields: Partial<ReaderDisplay>) => setDisplay({ ...display, ...fields })

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Display"
            className="size-8 text-muted-foreground data-popup-open:bg-secondary data-popup-open:text-foreground"
          />
        }
      >
        <TextAaIcon />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[300px] flex-col gap-2.5 rounded-[20px] bg-card p-4 shadow-card"
      >
        <div className="text-xs font-medium text-muted-foreground">Show</div>
        <label className="flex items-center gap-3 text-[13px]">
          <span className="flex-1">Translation</span>
          <Switch
            checked={display.translation}
            disabled={display.translation && !display.original}
            onCheckedChange={(translation) => change({ translation })}
          />
        </label>
        <label className="flex items-center gap-3 text-[13px]">
          <span className="flex-1">
            Original
            <span className="block text-xs text-muted-foreground">
              Under each translated paragraph
            </span>
          </span>
          <Switch
            checked={display.original}
            disabled={display.original && !display.translation}
            onCheckedChange={(original) => change({ original })}
          />
        </label>
        <div className="text-[11px] text-muted-foreground">One of the two always stays on.</div>
        <div className="mt-1 border-t pt-3 text-xs font-medium text-muted-foreground">Text</div>
        <Row label="Font">
          <Segments
            label="Font"
            options={fonts.map((option) => ({ value: option.font, label: option.label }))}
            value={display.font}
            onChange={(font) => change({ font })}
          />
        </Row>
        <Row label="Size">
          <Slider
            aria-label="Text size"
            className="w-36"
            min={14}
            max={26}
            step={1}
            value={display.size}
            onValueChange={(size) => change({ size: Number(size) })}
          />
        </Row>
        <Row label="Line spacing">
          <Slider
            aria-label="Line spacing"
            className="w-36"
            min={1.4}
            max={2.1}
            step={0.05}
            value={display.lineHeight}
            onValueChange={(lineHeight) => change({ lineHeight: Number(lineHeight) })}
          />
        </Row>
        <Row label="Width">
          <Segments
            label="Width"
            options={widths.map((option) => ({ value: option.width, label: option.label }))}
            value={display.width}
            onChange={(width) => change({ width })}
          />
        </Row>
        <Row label="Theme">
          <div className="flex gap-2">
            {themeOrder.map((theme) => (
              <ThemeSwatch
                key={theme}
                theme={theme}
                active={display.theme === theme}
                onPick={() => change({ theme })}
              />
            ))}
          </div>
        </Row>
      </PopoverContent>
    </Popover>
  )
}
