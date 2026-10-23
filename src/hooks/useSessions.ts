import { useEffect, useRef } from 'react';
import { useStore } from '@/ui/app/store';
import { onMessageTyped } from '@/messaging/bus';

/**
 * Initialize the session store on mount and subscribe to bus events for live updates.
 * Must be called once from a top-level component (e.g. SidePanel).
 */
export function useSessions(): void {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // hydrate sessions on mount (async — store handles it)
      useStore.getState().hydrate();
    }

    const unsub = onMessageTyped({
      sessionsChanged: () => {
        useStore.getState().onSessionsChanged();
      },
      tabsChanged: (msg) => {
        useStore.getState().onTabsChanged(msg.sessionId);
      },
      syncStatusChanged: (msg) => {
        useStore.getState().onSyncStatusChanged(msg.status);
      },
    });

    return unsub;
  }, []);
}
