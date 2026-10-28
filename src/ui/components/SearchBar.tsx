import { cn } from '@/lib';
import { t } from '@/lib/i18n';

interface SearchBarProps {
  value: string;
  onChange: (q: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
}

export function SearchBar({ value, onChange, onClear, placeholder, className }: SearchBarProps) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted select-none text-xs">
        🔍
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('sb_placeholder')}
        className="w-full rounded border border-surface-border bg-surface-base py-1.5 pl-7 pr-6 text-xs text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
      />
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:text-text-primary transition-colors"
          aria-label={t('sb_clear')}
        >
          ✕
        </button>
      )}
    </div>
  );
}