/**
 * Build a test-only copy of the extension with the sync origin promoted from
 * optional_host_permissions to required host_permissions.
 *
 * Why: Chrome's optional-permission prompt has no UI in headless Chromium, so
 * chrome.permissions.request() never settles and the extension can never fetch.
 * Granting up front reproduces the state of a user who accepted the prompt
 * once, without weakening the shipped manifest.
 *
 * Usage: await buildE2EExtension(origin) → path to the copy
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function buildE2EExtension(origin: string): string {
  const source = path.resolve('dist');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tabbary-ext-e2e-'));

  fs.cpSync(source, target, { recursive: true });

  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    host_permissions?: string[];
    optional_host_permissions?: string[];
  };

  const pattern = `${origin}/*`;
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), pattern])];
  manifest.optional_host_permissions = (manifest.optional_host_permissions ?? []).filter(
    (p) => p !== pattern,
  );

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}
