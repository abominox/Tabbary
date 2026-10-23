import { cn } from '@/lib';
import type { SyncStatus } from '@/ui/app/store';

interface SyncBadgeProps {
  status: SyncStatus;
  className?: string;
}

const STATUS_LABELS: Record<SyncStatus, string> = {
  'synced': 'Synced',
  'syncing': 'Syncing…',
  'paused': 'Paused',
  'error': 'Error',
  'local-only': 'Local only',
};

const STATUS_COLORS: Record<SyncStatus, string> = {
  'synced': 'text-green-500',
  'syncing': 'text-blue-500',
  'paused': 'text-yellow-500',
  'error': 'text-red-500',
  'local-only': 'text-text-muted',
};

export function SyncBadge({ status, className }: SyncBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        STATUS_COLORS[status],
        'bg-surface-hover',
        className,
      )}
      title={STATUS_LABELS[status]}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'synced' ? 'bg-green-500' :
          status === 'syncing' ? 'bg-blue-500' :
          status === 'error' ? 'bg-red-500' :
          status === 'paused' ? 'bg-yellow-500' :
          'bg-text-muted',
        )}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}