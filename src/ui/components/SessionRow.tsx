import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib';
import { formatRelativeTime } from '@/lib';
import type { Session, Tab } from '@/models';
import { TabMarkStrip } from './TabMarkStrip';

interface SessionRowProps {
  session: Session;
  tabs?: Tab[];
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  onFork?: (sessionId: string) => void;
  /** HTML5 drag support: called when the row starts being dragged. */
  onDragStart?: (e: React.DragEvent, sessionId: string) => void;
  className?: string;
}

export function SessionRow({
  session,
  tabs = [],
  onOpen,
  onDelete,
  onRename,
  onFork,
  onDragStart,
  className,
}: SessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.name || '');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleClick = () => {
    if (!renaming) onOpen(session.id);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== (session.name || '')) {
      onRename(session.id, trimmed);
    }
    setRenaming(false);
  };

  // Focus input when renaming
  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const displayName = session.name?.trim() || 'Untitled';
  const isActive = session.state === 'active';

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={onDragStart != null && !renaming}
      onDragStart={onDragStart ? (e) => onDragStart(e, session.id) : undefined}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-surface-hover',
        className,
      )}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* State indicator */}
      <div
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          isActive ? 'bg-green-500' : 'bg-surface-border',
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {renaming ? (
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="w-full rounded border border-accent-500 bg-surface-base px-1 py-0.5 text-xs outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="flex items-baseline gap-1.5">
              <span className="truncate font-medium text-text-primary">{displayName}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
                {tabs.length}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <TabMarkStrip tabs={tabs} muted={!isActive} size={14} max={4} />
              <span className="truncate text-[10px] text-text-muted">
                {formatRelativeTime(session.closedAt ?? session.updatedAt)}
              </span>
            </span>
          </>
        )}
      </div>

      {/* Context menu (⋯) */}
      <div
        ref={menuRef}
        className="relative shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className={cn(
            'rounded px-1 py-0.5 text-text-muted opacity-0 transition-opacity hover:bg-surface-border hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100',
            menuOpen && 'opacity-100',
          )}
          aria-label="Session actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-0.5 w-32 rounded border border-surface-border bg-surface-elevated py-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
                setRenameValue(session.name || '');
              }}
              className="flex w-full items-center px-3 py-1 text-[11px] text-text-primary hover:bg-surface-hover"
            >
              Rename
            </button>
            {onFork && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onFork(session.id);
                }}
                className="flex w-full items-center px-3 py-1 text-[11px] text-text-primary hover:bg-surface-hover"
              >
                Save a copy
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete(session.id);
              }}
              className="flex w-full items-center px-3 py-1 text-[11px] text-red-500 hover:bg-surface-hover"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
