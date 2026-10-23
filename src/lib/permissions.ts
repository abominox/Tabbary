/**
 * Dynamic host-permission helpers.
 * Used during sync setup to request access to the user's VPS endpoint.
 */

/** Normalize an origin and request host permission. Returns true if granted. */
export async function requestSyncHostPermission(origin: string): Promise<boolean> {
  const normalized = normalizeOrigin(origin);
  return chrome.permissions.request({ origins: [normalized + '/*'] });
}

/** Check whether a host permission is already granted. */
export async function hasHostPermission(origin: string): Promise<boolean> {
  const normalized = normalizeOrigin(origin);
  return chrome.permissions.contains({ origins: [normalized + '/*'] });
}

/** Remove a previously-granted host permission. */
export async function removeHostPermission(origin: string): Promise<void> {
  const normalized = normalizeOrigin(origin);
  await chrome.permissions.remove({ origins: [normalized + '/*'] });
}

function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin.startsWith('http') ? origin : `https://${origin}`);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    throw new Error(`Invalid origin: ${origin}`);
  }
}