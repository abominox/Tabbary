import { useState } from 'react';
import { cn } from '@/lib';
import type { Tab, TabGroup } from '@/models';
import { TabRow } from './TabRow';

interface TabGroupSectionProps {
  group: TabGroup;
  tabs: Tab[];
  onTabClick?: (tab: Tab) => void;
  className?: string;
}

const GROUP_COLORS: Record<string, string> = {
  grey: '#9ca3af',
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  pink: '#ec4899',
  purple: '#a855f7',
  cyan: '#06b6d4',
  orange: '#f97316',
};

export function TabGroupSection({ group, tabs, onTabClick, className }: TabGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(group.collapsed);
  const color = GROUP_COLORS[group.color] || GROUP_COLORS.grey;
  const displayTitle = group.title || 'Untitled group';

  if (tabs.length === 0) return null;

  return (
    <div className={cn('', className)}>
      {/* Group header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover"
      >
        <span
          className="h-4 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate">{displayTitle}</span>
        <span className="text-text-muted ml-auto text-[10px]">{tabs.length}</span>
        <span className="text-text-muted text-[10px]">{collapsed ? '▸' : '▾'}</span>
      </button>

      {/* Tab rows */}
      {!collapsed && (
        <div className="ml-2 border-l border-surface-border pl-1">
          {tabs
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((tab) => (
              <TabRow key={tab.id} tab={tab} onClick={onTabClick} />
            ))}
        </div>
      )}
    </div>
  );
}