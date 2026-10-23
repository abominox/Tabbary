import { cn } from '@/lib';
import { tabMark } from '@/lib/tabmark';
import type { Tab } from '@/models';

interface TabMarkStripProps {
  tabs: Tab[];
  /** How many tiles fit before the +N chip. */
  max?: number;
  /** Closed sessions render the strip dimmed. */
  muted?: boolean;
  /** Tile edge length in px. */
  size?: number;
  className?: string;
}

/**
 * A row of letter-tile favicons, one per tab, with a "+N" overflow chip.
 * Purely decorative: the surrounding control carries the accessible name.
 */
export function TabMarkStrip({
  tabs,
  max = 4,
  muted = false,
  size = 16,
  className,
}: TabMarkStripProps) {
  const visible = tabs.slice(0, max);
  const overflow = tabs.length - visible.length;

  if (visible.length === 0) return null;

  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center gap-[3px]', className)}
      style={{ opacity: muted ? 0.42 : 1 }}
    >
      {visible.map((tab, i) => {
        const mark = tabMark(tab.url, tab.title);
        return (
          <span
            key={tab.id ?? i}
            title={mark.host}
            className="inline-flex items-center justify-center rounded-[3px] font-semibold leading-none ring-1 ring-inset ring-black/[.04] dark:ring-white/[.06]"
            style={{
              width: size,
              height: size,
              backgroundColor: mark.bg,
              color: mark.fg,
              fontSize: Math.round(size * 0.58),
            }}
          >
            {mark.letter}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className="ml-[1px] font-mono text-[9px] leading-none text-text-muted"
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
