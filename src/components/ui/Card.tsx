import { cn } from '../../lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
}

export function Card({ children, className, onClick, hover }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4',
        hover && 'cursor-pointer transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)]',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardSection({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('border-t border-[var(--border)] pt-3 mt-3', className)}>
      {children}
    </div>
  )
}
