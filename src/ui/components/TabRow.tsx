import { cn } from '@/lib';
import type { Tab } from '@/models';
import { getFaviconUrl } from '@/lib';

interface TabRowProps {
  tab: Tab;
  onClick?: (tab: Tab) => void;
  className?: string;
}

const TRUNCATE_LENGTH = 48;

/** Extract hostname from a URL string. */
function hostname(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function TabRow({ tab, onClick, className }: TabRowProps) {
  const handleClick = () => {
    onClick?.(tab);
  };

  const favicon = tab.favIconUrl || getFaviconUrl(tab.url, 16);
  const title = tab.title?.trim() || tab.url;
  const truncated = title.length > TRUNCATE_LENGTH
    ? title.slice(0, TRUNCATE_LENGTH) + '…'
    : title;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-surface-hover',
        tab.active ? 'bg-accent-50/30 dark:bg-accent-500/10' : '',
        className,
      )}
    >
      <img
        src={favicon}
        alt=""
        className="h-4 w-4 shrink-0 rounded-sm"
        width={16}
        height={16}
        onError={(e) => {
          (e.target as HTMLImageElement).src =
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="%23e5e7eb" rx="2"/><text x="8" y="12" text-anchor="middle" font-size="10" fill="%239ca3af">🔗</text></svg>';
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-text-primary font-medium leading-tight">
          {truncated}
        </span>
        <span className="truncate text-text-muted text-[10px] leading-tight">
          {hostname(tab.url)}
        </span>
      </div>
      {tab.pinned && <span className="text-text-muted shrink-0 text-[10px]">📌</span>}
    </button>
  );
}