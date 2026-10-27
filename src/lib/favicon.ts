/**
 * Favicon extraction helpers.
 * Primary: chrome.runtime.getURL('_favicon/...') using the `favicon` permission.
 * Fallback: offscreen document DOM parsing for better quality icons.
 */

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

/**
 * Get the Chrome favicon URL for a page using the built-in _favicon API.
 * Requires the `favicon` permission (included in our manifest).
 */
export function getFaviconUrl(pageUrl: string, size: number = 16): string {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.href;
}

/**
 * Extract a higher-quality favicon URL by parsing the page's HTML in an offscreen document.
 * Uses chrome.offscreen.createDocument with reason DOM_PARSER.
 * Returns null if extraction fails or times out.
 */
export async function extractFaviconViaOffscreen(pageUrl: string): Promise<string | null> {
  try {
    // Check if an offscreen doc already exists; if so, close it to start fresh
    // (chrome.offscreen.hasDocument is not available in all chrome versions, so use try/catch)
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // No existing document — that's fine
    }

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Extract favicon URL from page HTML for session manager display',
    });

    const faviconUrl = await chrome.runtime.sendMessage({
      type: 'extractFavicon',
      url: pageUrl,
    });

    // Close the offscreen doc after use
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // Best-effort
    }

    return (faviconUrl as string | null) ?? null;
  } catch (err) {
    console.warn('[tabbary] offscreen favicon extraction failed:', err);
    return null;
  }
}