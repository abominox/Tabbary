/**
 * Rebuild Chrome tab groups when restoring a session.
 *
 * Capturing groups is easy; putting them back is the part people notice. This
 * creates the tabs first, then groups them via chrome.tabs.group, then applies
 * the saved title/colour/collapsed state.
 */

import type { Tab, TabGroup } from '@/models';

export interface RestorePlan {
  /** URLs in order, one entry per tab. */
  urls: string[];
  /** Parallel array: which saved group each tab belongs to, or null. */
  groupForIndex: (string | null)[];
  groups: TabGroup[];
}

/**
 * Build the restore plan from stored rows.
 *
 * Tabs and groups are positional, so this keeps the saved order and only
 * carries group ids that the session actually owns — a dangling id would make
 * every tab look grouped to a group that does not exist.
 */
export function planRestore(tabs: Tab[], groups: TabGroup[]): RestorePlan {
  const owned = new Map(groups.map((g) => [g.id, g]));
  const ordered = tabs
    .filter((t) => Boolean(t.url))
    .slice()
    .sort((a, b) => a.position - b.position);

  return {
    urls: ordered.map((t) => t.url),
    groupForIndex: ordered.map((t) =>
      t.groupId && owned.has(t.groupId) ? t.groupId : null,
    ),
    groups: groups.filter((g) => owned.has(g.id)),
  };
}

/**
 * Apply the plan in an existing window.
 *
 * `chrome.tabs.group` needs the tab ids, which only exist after creation, so
 * this runs in two passes: create all tabs, then group the ones that need it.
 * Failures are collected rather than thrown — a session with one broken group
 * should still restore its tabs.
 */
export async function applyGroups(
  windowId: number,
  tabIdsByIndex: (number | null)[],
  plan: RestorePlan,
): Promise<{ groupsCreated: number; errors: string[] }> {
  const errors: string[] = [];

  // Collect chrome tab ids per saved group, preserving order.
  const byGroup = new Map<string, number[]>();
  plan.groupForIndex.forEach((savedGroupId, index) => {
    if (!savedGroupId) return;
    const chromeId = tabIdsByIndex[index];
    if (chromeId == null) return;
    const list = byGroup.get(savedGroupId) ?? [];
    list.push(chromeId);
    byGroup.set(savedGroupId, list);
  });

  let groupsCreated = 0;

  for (const group of plan.groups) {
    const chromeTabIds = byGroup.get(group.id);
    if (!chromeTabIds || chromeTabIds.length === 0) continue;

    try {
      const chromeGroupId = await chrome.tabs.group({
        tabIds: chromeTabIds,
        createProperties: { windowId },
      });

      await chrome.tabGroups.update(chromeGroupId, {
        title: group.title || undefined,
        color: group.color,
        collapsed: group.collapsed,
      });

      groupsCreated++;
    } catch (err) {
      errors.push(`group "${group.title || group.color}": ${(err as Error).message}`);
    }
  }

  return { groupsCreated, errors };
}

/**
 * Create a window's tabs, then group them.
 *
 * Returns the new window id and how many groups were reconstructed, so the
 * caller can report "restored 3 groups" rather than silently guessing.
 */
export async function restoreIntoTabWindow(
  plan: RestorePlan,
  opts: { focused?: boolean; suspend?: boolean } = {},
): Promise<{ windowId: number | null; tabIds: (number | null)[]; groupsCreated: number; errors: string[] }> {
  if (plan.urls.length === 0) {
    return { windowId: null, tabIds: [], groupsCreated: 0, errors: [] };
  }

  const created = await chrome.windows.create({
    url: plan.urls[0],
    focused: opts.focused ?? true,
  });

  const windowId = created.id ?? null;
  if (windowId == null) {
    return { windowId: null, tabIds: [], groupsCreated: 0, errors: ['could not create a window'] };
  }

  const errors: string[] = [];
  const existing = await chrome.tabs.query({ windowId });
  const tabIds: (number | null)[] = [existing[0]?.id ?? null];

  for (const url of plan.urls.slice(1)) {
    try {
      const tab = await chrome.tabs.create({ windowId, url, active: false });
      tabIds.push(tab.id ?? null);
    } catch (err) {
      tabIds.push(null);
      errors.push(`tab "${url}": ${(err as Error).message}`);
    }
  }

  const grouped = await applyGroups(windowId, tabIds, plan);

  // "Open without loading" — discard every restored tab except the first, so
  // the window exists but memory stays flat until a tab is clicked.
  if (opts.suspend) {
    for (const id of tabIds.slice(1)) {
      if (id == null) continue;
      try {
        await chrome.tabs.discard(id);
      } catch {
        /* Chrome may refuse; not fatal */
      }
    }
  }

  return {
    windowId,
    tabIds,
    groupsCreated: grouped.groupsCreated,
    errors: [...errors, ...grouped.errors],
  };
}
