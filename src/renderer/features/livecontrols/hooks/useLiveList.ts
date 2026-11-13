import { Exit } from 'effect'
import { useEffect, useState } from 'react'
import { formErrorOf } from '#lib/forms'

export type ListStatus = 'loading' | 'idle' | 'failed'

type Load<A, E> = (input: {
  readonly payload: undefined
}) => Promise<Exit.Exit<ReadonlyArray<A>, E>>

export const useLiveList = <A, E>(load: Load<A, E>, same: (left: A, right: A) => boolean) => {
  const [items, setItems] = useState<ReadonlyArray<A>>([])
  const [status, setStatus] = useState<ListStatus>('loading')
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let current = true

    void load({ payload: undefined }).then((exit) => {
      if (!current) {
        return
      }

      if (Exit.isSuccess(exit)) {
        setItems(exit.value)
        setStatus('idle')

        return
      }

      setStatus('failed')
      setError(formErrorOf(exit)?.message)
    })

    return () => {
      current = false
    }
  }, [load])

  const replace = (updated: A) =>
    setItems((all) => all.map((item) => (same(item, updated) ? updated : item)))

  return { items, status, error, setError, replace }
}
