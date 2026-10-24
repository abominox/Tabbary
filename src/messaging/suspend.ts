// Suspension messages.

export interface SuspendWindowMessage {
  type: 'suspendWindow';
  windowId: number;
  /** Override the idle threshold, in minutes. */
  minIdleMinutes?: number;
}

export interface SuspendPreviewMessage {
  type: 'suspendPreview';
  windowId: number;
  minIdleMinutes?: number;
}

export interface SuspendResult {
  discarded: number;
  skipped: { tabId: number | undefined; title: string; reason: string }[];
}

export type SuspendMessage = SuspendWindowMessage | SuspendPreviewMessage;
