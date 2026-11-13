import { cn } from 'cn'
import type { GameProgress } from '#contract/Dashboard'
import { engineLabels } from '#contract/Library'
import { formatUsd } from '#lib/format'
import { Button } from '#ui/button'
import { OverflowText } from '#ui/overflow-text'
import type { NoticeAction } from '../notices'
import { useNoticeAction } from '../useNoticeAction'

const number = (value: number) => value.toLocaleString('en')

const notes = (game: GameProgress) =>
  [
    game.pending === 0 ? undefined : `${number(game.pending)} changed`,
    game.lastRun?.stoppedAtLimit === true && game.translated < game.lines
      ? 'stopped at limit'
      : undefined,
    game.skipped === 0 ? undefined : `${number(game.skipped)} skipped`,
  ].filter((note) => note !== undefined)

const nextStep = (
  game: GameProgress,
): { readonly label: string; readonly action: NoticeAction; readonly done: boolean } => {
  if (game.pending > 0) {
    return {
      label: 'Translate changes',
      action: { kind: 'game', gameId: game.gameId, view: 'changes' },
      done: false,
    }
  }

  if (game.skipped > 0) {
    return {
      label: 'Review skipped',
      action: { kind: 'game', gameId: game.gameId, view: 'review' },
      done: false,
    }
  }

  if (game.translated < game.lines) {
    return { label: 'Continue', action: { kind: 'game', gameId: game.gameId }, done: false }
  }

  return {
    label: 'Review',
    action: { kind: 'game', gameId: game.gameId, view: 'review' },
    done: true,
  }
}

export function ProgressTable({ games }: { readonly games: ReadonlyArray<GameProgress> }) {
  const act = useNoticeAction()

  return (
    <section className="rounded-3xl bg-card px-[22px] py-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">Translation progress</h2>
      {games.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No game has been translated yet. Translate one from its page in the Library.
        </p>
      ) : (
        <table className="w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Game</th>
              <th className="w-[40%] pb-2 font-medium">Lines</th>
              <th className="w-24 pb-2 text-right font-medium">Spent</th>
              <th className="w-[150px] pb-2" />
            </tr>
          </thead>
          <tbody>
            {games.map((game) => {
              const step = nextStep(game)
              const share = game.lines === 0 ? 0 : game.translated / game.lines
              const extra = notes(game)

              return (
                <tr key={game.gameId} className="border-t">
                  <td className="py-2.5 pr-4">
                    <OverflowText className="font-semibold">{game.title}</OverflowText>
                    <OverflowText className="text-xs text-muted-foreground">
                      {engineLabels[game.engine]}
                    </OverflowText>
                  </td>
                  <td className="py-2.5 pr-6">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${share * 100}%` }}
                      />
                    </div>
                    <OverflowText className="mt-1.5 text-xs text-muted-foreground">
                      {[`${number(game.translated)} of ${number(game.lines)}`, ...extra].join(
                        ' · ',
                      )}
                    </OverflowText>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{formatUsd(game.costUsd)}</td>
                  <td className="py-2.5 text-right">
                    <Button
                      variant={step.done ? 'ghost' : 'secondary'}
                      className={cn(
                        'h-7 rounded-full px-3 text-[13px] font-normal',
                        step.done && 'text-muted-foreground',
                      )}
                      onClick={() => act(step.action)}
                    >
                      {step.label}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
