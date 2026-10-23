import type { Tab, TabGroup, Session } from '@/models';
import { cn } from '@/lib';
import { TabRow } from './TabRow';
import { TabGroupSection } from './TabGroupSection';
import { EmptyState } from './EmptyState';

interface ActiveSessionProps {
  session: Session | null;
  tabs: Tab[];
  groups: TabGroup[];
  onTabClick?: (tab: Tab) => void;
  className?: string;
}

/** Navigate chrome to the tab (only if it's active/live). */
function switchToTab(tab: Tab) {
  if (tab.chromeTabId != null) {
    chrome.tabs.update(tab.chromeTabId, { active: true }).catch(() => {
      // Tab may have been closed — ignore
    });
  }
}

export function ActiveSession({ session, tabs, groups, onTabClick, className }: ActiveSessionProps) {
  if (!session) {
    return (
      <div className={cn('flex flex-col', className)}>
        <h2 className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Active Session
        </h2>
        <div className="flex-1 flex items-center justify-center px-3">
          <EmptyState message="No active session — open a window to start" />
        </div>
      </div>
    );
  }

  const handleTabClick = onTabClick ?? switchToTab;

  // Split tabs into pinned, grouped (by groupId), ungrouped
  const pinned = tabs.filter((t) => t.pinned).sort((a, b) => a.position - b.position);
  const grouped = tabs.filter((t) => t.groupId != null && !t.pinned);
  const ungrouped = tabs.filter((t) => t.groupId == null && !t.pinned).sort((a, b) => a.position - b.position);

  const tabCount = tabs.length;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Session header */}
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
        <h2 className="truncate text-sm font-semibold text-text-primary">
          {session.name || 'Untitled'}
        </h2>
        <span className="shrink-0 text-[11px] text-text-muted">{tabCount} tab{tabCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto px-1 pb-2 space-y-0.5">
        {/* Pinned tabs */}
        {pinned.length > 0 && (
          <div>
            <div className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
              Pinned
            </div>
            {pinned.map((tab) => (
              <TabRow key={tab.id} tab={tab} onClick={handleTabClick} />
            ))}
          </div>
        )}

        {/* Grouped tabs */}
        {groups.map((group) => {
          const groupTabs = grouped
            .filter((t) => t.groupId === group.id)
            .sort((a, b) => a.position - b.position);
          if (groupTabs.length === 0) return null;
          return (
            <TabGroupSection
              key={group.id}
              group={group}
              tabs={groupTabs}
              onTabClick={handleTabClick}
            />
          );
        })}

        {/* Ungrouped tabs */}
        {ungrouped.length > 0 && (
          <div>
            {ungrouped.map((tab) => (
              <TabRow key={tab.id} tab={tab} onClick={handleTabClick} />
            ))}
          </div>
        )}

        {tabs.length === 0 && (
          <div className="px-3 py-4">
            <EmptyState message="No tabs in this session" />
          </div>
        )}
      </div>
    </div>
  );
}