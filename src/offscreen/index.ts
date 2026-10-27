/// <reference types="chrome" />

/**
 * Offscreen document for DOM-dependent work.
 * Used only for favicon extraction (reason required by MV3: DOM_PARSER).
 * Runs in a hidden document; communicates via chrome.runtime.onMessage.
 */

interface ExtractFaviconRequest {
  type: 'extractFavicon';
  url: string;
}

type OffscreenRequest = ExtractFaviconRequest;

async function extractFavicon(pageUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Collect all <link rel="icon" ...> candidates
    const links = doc.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon"], link[rel~="shortcut icon"], link[rel~="apple-touch-icon"]',
    );

    const candidates: { href: string; size: number }[] = [];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      const resolved = new URL(href, pageUrl).href;
      const sizes = link.getAttribute('sizes') || '';
      const size = sizes.match(/(\d+)x(\d+)/);
      candidates.push({ href: resolved, size: size ? parseInt(size[1]!, 10) : 0 });
    }

    if (candidates.length === 0) {
      // Fallback: /favicon.ico
      const u = new URL('/favicon.ico', pageUrl);
      return u.href;
    }

    // Best match: largest size <= 64, or any icon, or the first one
    candidates.sort((a, b) => (a.size !== b.size ? b.size - a.size : 0));
    return candidates[0]!.href;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener(
  (msg: unknown, _sender, sendResponse) => {
    const req = msg as OffscreenRequest;

    if (req.type === 'extractFavicon') {
      extractFavicon(req.url).then(sendResponse);
      return true; // keep channel open for async response
    }
  },
);

// Log that the offscreen doc is alive (debug)
console.log('[tabbary offscreen] ready');

export {};