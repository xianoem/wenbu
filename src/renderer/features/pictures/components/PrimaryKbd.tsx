import type { ReactNode } from 'react'
import { Kbd } from '../../mangaEditor/components/Kbd'

export function PrimaryKbd({ children }: { readonly children: ReactNode }) {
  return (
    <Kbd className="border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground/70">
      {children}
    </Kbd>
  )
}
