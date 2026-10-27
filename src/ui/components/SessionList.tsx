import { cn } from '@/lib';
import { sendMessage } from '@/messaging/bus';
import type { Session, Tab } from '@/models';
import { SessionRow } from './SessionRow';

interface SessionListProps {
  sessions: Session[];
  tabsBySession: Record<string, Tab[]>;
  activeSessionId?: string | null;
  onSelect?: (sessionId: string) => void;
  /** Drop target: tabs dragged from elsewhere land in this session. */
  onDropTabs?: (sessionId: string, tabIds: string[]) => void;
  className?: string;
  emptyMessage?: string;
  heading?: string;
}

function openSession(sessionId: string) {
  sendMessage({ type: 'openSession', sessionId }).catch(() => {});
}

function deleteSession(sessionId: string) {
  sendMessage({ type: 'deleteSession', sessionId }).catch(() => {});
}

function renameSession(sessionId: string, name: string) {
  sendMessage({ type: 'renameSession', sessionId, name }).catch(() => {});
}

function forkSession(sessionId: string) {
  sendMessage({ type: 'duplicateSession', sessionId }).catch(() => {});
}

export function SessionList({
  sessions,
  tabsBySession,
  activeSessionId,
  onSelect,
  onDropTabs,
  className,
  emptyMessage = 'No sessions yet',
  heading,
}: SessionListProps) {
  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('application/x-tabbary-session', sessionId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!onDropTabs) return;
    if (e.dataTransfer.types.includes('application/x-tabbary-tabs')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDrop = (e: React.DragEvent, sessionId: string) => {
    if (!onDropTabs) return;
    const raw = e.dataTransfer.getData('application/x-tabbary-tabs');
    if (!raw) return;
    e.preventDefault();
    const ids = raw.split(',').filter(Boolean);
    if (ids.length > 0) onDropTabs(sessionId, ids);
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {heading && (
        <div className="flex items-center gap-2 px-2 py-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {heading}
          </h3>
          <span className="text-[10px] text-text-muted">{sessions.length}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-2">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-muted">
            {emptyMessage}
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, session.id)}
              className={cn(
                'rounded-sm',
                activeSessionId === session.id && 'bg-accent-50/40 dark:bg-accent-500/10',
              )}
            >
              <SessionRow
                session={session}
                tabs={tabsBySession[session.id] ?? []}
                onOpen={onSelect ?? openSession}
                onDelete={deleteSession}
                onRename={renameSession}
                onFork={forkSession}
                onDragStart={handleDragStart}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
