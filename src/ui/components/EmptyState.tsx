import { cn } from '@/lib';

interface EmptyStateProps {
  message: string;
  icon?: string;
  className?: string;
}

export function EmptyState({ message, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      {icon && <span className="text-lg">{icon}</span>}
      <p className="text-center text-xs text-text-muted leading-relaxed">{message}</p>
    </div>
  );
}