import { db } from '@/db/schema';
import type { Settings } from '@/models';
import { DEFAULT_SETTINGS } from '@/models';

function now(): number {
  return Date.now();
}

export const settingsRepo = {
  /**
   * Get the single settings row (id='settings'). If missing, insert DEFAULT_SETTINGS
   * and return it.
   */
  async get(): Promise<Settings> {
    const row = await db.table('settings').get('settings');
    if (row) {
      return row as unknown as Settings;
    }
    // Insert defaults
    await db.table('settings').add({
      id: 'settings',
      ...DEFAULT_SETTINGS,
      createdAt: now(),
      updatedAt: now(),
    } as any);
    return { ...DEFAULT_SETTINGS };
  },

  /**
   * Update settings by merging with existing. If row doesn't exist, inserts defaults
   * first then applies merge.
   */
  async update(patch: Partial<Settings>): Promise<void> {
    const existing = await db.table('settings').get('settings');
    if (existing) {
      await db.table('settings').update('settings', {
        ...patch,
        updatedAt: now(),
      } as any);
    } else {
      // Insert defaults + patch
      await db.table('settings').add({
        id: 'settings',
        ...DEFAULT_SETTINGS,
        ...patch,
        createdAt: now(),
        updatedAt: now(),
      } as any);
    }
  },

  /** Reset settings back to defaults. */
  async reset(): Promise<void> {
    const existing = await db.table('settings').get('settings');
    if (existing) {
      await db.table('settings').update('settings', {
        ...DEFAULT_SETTINGS,
        updatedAt: now(),
      } as any);
    } else {
      await db.table('settings').add({
        id: 'settings',
        ...DEFAULT_SETTINGS,
        createdAt: now(),
        updatedAt: now(),
      } as any);
    }
  },
};