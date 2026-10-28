import { cn } from '@/lib';
import { t } from '@/lib/i18n';

export function SurfaceSwitcher({ className }: { className?: string }) {
  const openSurface = (path: string) => {
    chrome.tabs.create({ url: chrome.runtime.getURL(path) }).catch(() => {
      // Extension context not available (testing/error)
    });
  };

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <button
        type="button"
        onClick={() => openSurface('index.html')}
        className="rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
        title={t('sw_full_tab')}
      >
        📄 Tab
      </button>
      <button
        type="button"
        onClick={() => openSurface('window.html')}
        className="rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
        title={t('sw_window')}
      >
        🪟 Window
      </button>
      <button
        type="button"
        onClick={() => openSurface('popup.html')}
        className="rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
        title={t('sw_popup')}
      >
        🗔 Popup
      </button>
    </div>
  );
}