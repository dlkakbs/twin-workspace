import { cn, STATUS_CONFIG } from '../../lib/utils'
import type { TaskStatus } from '../../types'

interface StatusDotProps {
  status: TaskStatus
  showLabel?: boolean
  className?: string
}

export function StatusDot({ status, showLabel, className }: StatusDotProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('h-2 w-2 rounded-full shrink-0', cfg.dot)} />
      {showLabel && <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>}
    </span>
  )
}
