import { cn } from 'cn'
import type { LlmConnection, Verification } from '#contract/Llm'

const dotColors: Record<Verification, string> = {
  verified: 'bg-success',
  inconclusive: 'bg-warning',
  failed: 'bg-destructive',
}

const statusText = (connection: LlmConnection) => {
  if (connection.verification === 'verified') {
    return 'Verified'
  }

  return connection.verificationMessage ?? 'Not verified yet'
}

export function VerificationDot({ verification }: { readonly verification: Verification }) {
  return (
    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dotColors[verification])} />
  )
}

const pills: Record<Verification, { readonly label: string; readonly className: string }> = {
  verified: { label: 'Verified', className: 'bg-success/10 text-success' },
  inconclusive: { label: 'Not verified', className: 'bg-warning/10 text-warning' },
  failed: { label: 'Check failed', className: 'bg-destructive/10 text-destructive' },
}

export function VerificationPill({ verification }: { readonly verification: Verification }) {
  const pill = pills[verification]

  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium',
        pill.className,
      )}
    >
      <VerificationDot verification={verification} />
      {pill.label}
    </span>
  )
}

export function VerificationStatus({ connection }: { readonly connection: LlmConnection }) {
  return (
    <span className="inline-flex items-center gap-2">
      <VerificationDot verification={connection.verification} />
      <span className={connection.verification === 'failed' ? 'text-destructive' : undefined}>
        {statusText(connection)}
      </span>
    </span>
  )
}
