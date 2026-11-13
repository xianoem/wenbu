import { useAtomSet } from '@effect/atom-react'
import { Predicate } from 'effect'
import { useEffect } from 'react'
import { reportRendererErrorAtom } from './diagnostics'

const stackOf = (error: Error | undefined) =>
  error?.stack === undefined ? {} : { stack: error.stack }

export function RendererErrors({ source }: { readonly source: string }) {
  const report = useAtomSet(reportRendererErrorAtom)

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const error = Predicate.isError(event.error) ? event.error : undefined

      report({
        payload: {
          window: source,
          message: event.message === '' ? (error?.message ?? 'Unknown error') : event.message,
          ...stackOf(error),
        },
      })
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: unknown = event.reason
      const error = Predicate.isError(reason) ? reason : undefined

      report({
        payload: {
          window: source,
          message: error?.message ?? `Unhandled rejection: ${String(reason)}`,
          ...stackOf(error),
        },
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [report, source])

  return null
}
