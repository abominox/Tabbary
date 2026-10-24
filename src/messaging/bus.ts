// Thin typed wrappers around chrome.runtime messaging.
import type { Message, MessageResponse } from './messages';

/** Send a typed message to the other end (UI→SW or SW→UI). */
export function sendMessage<T extends Message>(msg: T): Promise<MessageResponse<T>> {
  return chrome.runtime.sendMessage(msg) as Promise<MessageResponse<T>>;
}

/** Register a raw message handler (untyped dispatch fallback). */
export function onMessage(handler: (msg: Message) => Promise<unknown> | void): void {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, _sender, sendResponse) => {
      const result = handler(msg as Message);
      if (result instanceof Promise) {
        result.then(sendResponse, () => {});
        return true; // keep channel open for async response
      }
      if (result !== undefined) {
        sendResponse(result);
      }
    },
  );
}

/** Type-safe dispatcher that narrows each message by its `type` discriminant. */
export function onMessageTyped(
  handlers: {
    [K in Message['type']]?: (
      msg: Extract<Message, { type: K }>,
      sender: chrome.runtime.MessageSender,
    ) => Promise<MessageResponse<Extract<Message, { type: K }>>> | void;
  },
): () => void {
  const handler = (
    msg: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    const typed = msg as Message;
    const h = handlers[typed.type] as
      | ((msg: Message, sender: chrome.runtime.MessageSender) => Promise<unknown> | void)
      | undefined;

    if (!h) return false;

    const result = h(typed, sender);
    if (result instanceof Promise) {
      result.then(sendResponse, () => {});
      return true;
    }
    if (result !== undefined) {
      sendResponse(result);
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(handler);

  // Return unsubscribe
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/** Fire-and-forget broadcast from SW to all UI contexts (or vice versa). */
export function broadcast(event: Extract<Message, { type: 'sessionsChanged' | 'tabsChanged' | 'syncStatusChanged' | 'restored' }>): void {
  chrome.runtime.sendMessage(event).catch(() => {
    // Ignore — no connected UI surfaces is normal
  });
}