import type { GameUsage, PresetUsage } from '#contract/Dashboard'
import { formatCount, formatUsd } from '#lib/format'
import { OverflowText } from '#ui/overflow-text'

function PresetTable({ presets }: { readonly presets: ReadonlyArray<PresetUsage> }) {
  return (
    <section className="rounded-3xl bg-card px-[22px] py-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">By preset and model</h2>
      {presets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests in this period.</p>
      ) : (
        <table className="w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Preset</th>
              <th className="w-[26%] pb-2 font-medium">Model</th>
              <th className="w-20 pb-2 pl-4 text-right font-medium">Requests</th>
              <th className="w-20 pb-2 pl-4 text-right font-medium">Tokens</th>
              <th className="w-24 pb-2 pl-4 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {presets.map((preset) => (
              <tr key={`${preset.presetName}\u0000${preset.modelId}`} className="border-t">
                <td className="py-2.5 pr-3 font-semibold">
                  <OverflowText>{preset.presetName}</OverflowText>
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">
                  <OverflowText>
                    {preset.modelId === '' ? 'Earlier runs' : preset.modelId}
                  </OverflowText>
                </td>
                <td className="py-2.5 pl-4 text-right tabular-nums">
                  {preset.requests.toLocaleString('en')}
                </td>
                <td className="py-2.5 pl-4 text-right tabular-nums">
                  {formatCount(preset.tokens)}
                </td>
                <td className="py-2.5 pl-4 text-right tabular-nums">
                  {preset.unpriced ? (
                    <span className="text-muted-foreground">Unpriced</span>
                  ) : (
                    formatUsd(preset.costUsd)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function GameTable({ games }: { readonly games: ReadonlyArray<GameUsage> }) {
  const most = Math.max(...games.map((game) => game.costUsd), 0)

  return (
    <section className="rounded-3xl bg-card px-[22px] py-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">By game</h2>
      {games.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests in this period.</p>
      ) : (
        <table className="w-full table-fixed text-[13px]">
          <tbody>
            {games.map((game) => (
              <tr key={game.gameId ?? ''} className="border-t first:border-t-0">
                <td
                  className={
                    game.gameId === undefined
                      ? 'w-[46%] py-2.5 pr-4 text-muted-foreground'
                      : 'w-[46%] py-2.5 pr-4 font-semibold'
                  }
                >
                  <OverflowText>{game.title}</OverflowText>
                </td>
                <td className="py-2.5">
                  <div
                    className={
                      game.gameId === undefined
                        ? 'h-1.5 rounded-full bg-chart-4'
                        : 'h-1.5 rounded-full bg-chart-1'
                    }
                    style={{ width: `${most === 0 ? 0 : (game.costUsd / most) * 100}%` }}
                  />
                </td>
                <td className="w-20 py-2.5 text-right tabular-nums">{formatUsd(game.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function SpendTables({
  presets,
  games,
}: {
  readonly presets: ReadonlyArray<PresetUsage>
  readonly games: ReadonlyArray<GameUsage>
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-4">
      <PresetTable presets={presets} />
      <GameTable games={games} />
    </div>
  )
}
