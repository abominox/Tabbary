import { cn } from '@/lib';
import { sendMessage } from '@/messaging/bus';
import type { Session } from '@/models';
import { SessionRow } from './SessionRow';

interface ClosedSessionsListProps {
  sessions: Session[];
  className?: string;
  sessionCount?: number;
}

function openSession(sessionId: string) {
  sendMessage({ type: 'openSession', sessionId }).catch(() => {
    // SW not ready
  });
}

function deleteSession(sessionId: string) {
  sendMessage({ type: 'deleteSession', sessionId }).catch(() => {
    // SW not ready
  });
}

function renameSession(sessionId: string, name: string) {
  sendMessage({ type: 'renameSession', sessionId, name }).catch(() => {
    // SW not ready
  });
}

export function ClosedSessionsList({ sessions, className, sessionCount }: ClosedSessionsListProps) {
  const count = sessionCount ?? sessions.length;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Library header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Library
        </h3>
        <span className="text-text-muted text-[10px]">{count}</span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-text-muted">
            No sessions yet
          </div>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onOpen={openSession}
              onDelete={deleteSession}
              onRename={renameSession}
            />
          ))
        )}
      </div>
    </div>
  );
}