import { MapTrifoldIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import type { MapSketch, SketchMarkKind } from '#contract/GameGuide'

const markColors: Record<SketchMarkKind, string> = {
  person: 'var(--muted-foreground)',
  thing: 'var(--tint-violet-foreground)',
  shop: 'var(--tint-teal-foreground)',
  exit: 'var(--foreground)',
  battle: 'var(--tint-amber-foreground)',
  other: 'var(--muted-foreground)',
}

const walkable = (sketch: MapSketch) => {
  if (sketch.passable === undefined) {
    return undefined
  }

  const bytes = Uint8Array.from(atob(sketch.passable), (char) => char.charCodeAt(0))

  return (x: number, y: number) => {
    const index = y * sketch.width + x

    return ((bytes[index >> 3] ?? 0) & (1 << (index & 7))) !== 0
  }
}

export function MapSketchView({
  sketch,
  width,
}: {
  readonly sketch: MapSketch
  readonly width: number
}) {
  const tile = Math.max(2, Math.min(14, Math.floor(width / Math.max(sketch.width, 1))))
  const height = Math.min(tile * sketch.height, 260)
  const tall = tile * sketch.height > height
  const focus = sketch.target ?? sketch.player

  const offsetY =
    tall && focus !== undefined
      ? Math.max(0, Math.min(focus.y * tile - height / 2, tile * sketch.height - height))
      : 0

  const walls = useMemo(() => {
    const canWalk = walkable(sketch)

    if (canWalk === undefined) {
      return ''
    }

    let path = ''

    for (let y = 0; y < sketch.height; y++) {
      for (let x = 0; x < sketch.width; x++) {
        if (!canWalk(x, y)) {
          path += `M${x * tile} ${y * tile}h${tile}v${tile}h${-tile}z`
        }
      }
    }

    return path
  }, [sketch, tile])

  const center = (value: number) => value * tile + tile / 2

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-[oklch(0.18_0.01_160)] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]"
      style={{ width: tile * sketch.width, maxWidth: width, height }}
    >
      <svg
        role="img"
        aria-label={`Map of ${sketch.name}`}
        width={tile * sketch.width}
        height={tile * sketch.height}
        style={{ transform: `translateY(${-offsetY}px)` }}
      >
        <path d={walls} fill="oklch(0.3 0.04 160)" />
        {sketch.marks.map((mark) => (
          <circle
            key={`${mark.x},${mark.y},${mark.label}`}
            cx={center(mark.x)}
            cy={center(mark.y)}
            r={Math.max(2, tile / 3)}
            fill={markColors[mark.kind]}
          >
            <title>{mark.label}</title>
          </circle>
        ))}
        {sketch.target === undefined ? null : (
          <g>
            <circle
              cx={center(sketch.target.x)}
              cy={center(sketch.target.y)}
              r={Math.max(6, tile)}
              fill="var(--tint-teal-foreground)"
              opacity={0.25}
            />
            <circle
              cx={center(sketch.target.x)}
              cy={center(sketch.target.y)}
              r={Math.max(3, tile / 2)}
              fill="var(--tint-teal-foreground)"
            />
          </g>
        )}
        {sketch.player === undefined ? null : (
          <path
            d={`M${center(sketch.player.x)} ${sketch.player.y * tile} l${tile / 2 + 1} ${tile} h${-tile - 2} z`}
            fill="var(--foreground)"
          >
            <title>You</title>
          </path>
        )}
      </svg>
      <span className="absolute top-2 left-2 inline-flex h-5 items-center gap-1 rounded-full bg-black/50 px-2 text-[11px] font-medium text-white">
        <MapTrifoldIcon className="size-3" />
        {sketch.name}
      </span>
    </div>
  )
}
