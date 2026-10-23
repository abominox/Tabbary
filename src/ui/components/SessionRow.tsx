import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib';
import { formatRelativeTime } from '@/lib';
import type { Session } from '@/models';

interface SessionRowProps {
  session: Session;
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, name: string) => void;
  className?: string;
}

export function SessionRow({ session, onOpen, onDelete, onRename, className }: SessionRowProps) {
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

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-surface-hover cursor-pointer',
        className,
      )}
      onClick={handleClick}
    >
      {/* State indicator */}
      <div
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          session.state === 'active' ? 'bg-green-500' : 'bg-surface-border',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
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
            <span className="truncate text-text-primary font-medium">{displayName}</span>
            <span className="text-text-muted text-[10px]">
              v{session.version} · {formatRelativeTime(session.closedAt ?? session.updatedAt)}
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
            'rounded px-1 py-0.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-border hover:text-text-primary',
            menuOpen && 'opacity-100',
          )}
          aria-label="Session actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-0.5 w-28 rounded border border-surface-border bg-surface-elevated py-1 shadow-lg">
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