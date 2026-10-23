import { cn } from '@/lib';
import type { FilterMode } from '@/ui/app/store';

interface TagRailProps {
  tags: { id: string; name: string; color?: string }[];
  selectedTagIds: string[];
  onToggleTag: (tagId: string) => void;
  filter: FilterMode;
  onFilterChange: (f: FilterMode) => void;
  className?: string;
}

export function TagRail({
  tags,
  selectedTagIds,
  onToggleTag,
  filter,
  onFilterChange,
  className,
}: TagRailProps) {
  const visibleTags = tags.slice(0, 30);
  const hasMore = tags.length > 30;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Tag filter chips */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleTags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => onToggleTag(tag.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface-hover text-text-secondary hover:bg-surface-border hover:text-text-primary',
                )}
                style={
                  tag.color && !active
                    ? { borderLeftColor: tag.color, borderLeftWidth: 3 }
                    : undefined
                }
              >
                {tag.name}
                {active && <span className="text-white/70 ml-0.5">✕</span>}
              </button>
            );
          })}
          {hasMore && (
            <span className="text-text-muted px-1 text-[10px] leading-5">
              +{tags.length - 30} more
            </span>
          )}
        </div>
      )}

      {/* Active / Closed filter toggle */}
      <div className="mt-auto flex rounded border border-surface-border overflow-hidden text-[11px] font-medium">
        {(['all', 'active', 'closed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilterChange(f)}
            className={cn(
              'flex-1 px-2 py-1 transition-colors',
              filter === f
                ? 'bg-accent-500 text-white'
                : 'bg-surface-base text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            {f === 'all' ? 'All' : f === 'active' ? 'Open' : 'Closed'}
          </button>
        ))}
      </div>
    </div>
  );
}