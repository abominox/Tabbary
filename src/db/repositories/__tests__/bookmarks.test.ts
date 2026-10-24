import { describe, it, expect } from 'vitest';
import {
  bookmarksRepo,
  collectUrls,
  countLinks,
  flattenChromeTree,
  bookmarksToTabs,
  type BookmarkNode,
} from '@/db/repositories/bookmarks';
import type { Bookmark } from '@/models';

const ts = 1_700_000_000_000;

function node(overrides: Partial<BookmarkNode> = {}): BookmarkNode {
  return {
    id: `b-${Math.random().toString(36).slice(2, 8)}`,
    type: 'session',
    ownerId: 'owner-1',
    parentId: null,
    title: 'Link',
    url: 'https://example.com',
    isFolder: false,
    position: 0,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    children: [],
    ...overrides,
  };
}

describe('buildTree', () => {
  it('nests folders and sorts folders before links', () => {
    const rows: Bookmark[] = [
      { ...node({ id: 'link', parentId: null, position: 0, title: 'Link' }) },
      { ...node({ id: 'folder', parentId: null, position: 1, isFolder: true, title: 'Folder' }) },
      { ...node({ id: 'child', parentId: 'folder', position: 0, isFolder: false }) },
    ];

    const tree = bookmarksRepo.buildTree(rows, null as unknown as string);
    // buildTree compares with parentId; roots use '' or null depending on caller.
    const roots = bookmarksRepo.buildTree(
      rows.map((r) => ({ ...r, parentId: r.parentId ?? '' })),
      '',
    );
    expect(roots.map((n) => n.id)).toEqual(['folder', 'link']);
    expect(roots[0]!.children.map((n) => n.id)).toEqual(['child']);
    expect(tree).toBeDefined();
  });

  it('returns an empty array for an empty scope', () => {
    expect(bookmarksRepo.buildTree([], '')).toEqual([]);
  });
});

describe('collectUrls', () => {
  it('walks nested folders and keeps portable URLs only', () => {
    const tree: BookmarkNode[] = [
      node({
        isFolder: true,
        children: [
          node({ url: 'https://a.test' }),
          node({
            isFolder: true,
            children: [node({ url: 'https://b.test' }), node({ url: 'chrome://settings' })],
          }),
        ],
      }),
      node({ url: 'https://c.test' }),
    ];

    expect(collectUrls(tree)).toEqual(['https://a.test', 'https://b.test', 'https://c.test']);
  });

  it('ignores folders and empty urls', () => {
    expect(collectUrls([node({ isFolder: true }), node({ url: undefined })])).toEqual([]);
  });
});

describe('countLinks', () => {
  it('counts only links, not folders', () => {
    const tree: BookmarkNode[] = [
      node({ isFolder: true, children: [node(), node()] }),
      node(),
      node({ isFolder: true, children: [] }),
    ];
    expect(countLinks(tree)).toBe(3);
  });
});

describe('flattenChromeTree', () => {
  it('flattens nested Chrome nodes with prefixed ids', () => {
    const chromeTree = [
      {
        id: '1',
        title: 'Bookmarks bar',
        children: [
          { id: '1.1', title: 'Example', url: 'https://example.com' },
          {
            id: '1.2',
            title: 'Reading',
            children: [{ id: '1.2.1', title: 'Docs', url: 'https://docs.test' }],
          },
        ],
      },
    ] as unknown as chrome.bookmarks.BookmarkTreeNode[];

    const rows = flattenChromeTree(chromeTree, 'browser', 'root');

    expect(rows).toHaveLength(4);
    expect(rows[0]!.id).toBe('chrome-browser-1');
    expect(rows[0]!.isFolder).toBe(true);
    expect(rows[1]!.parentId).toBe('chrome-browser-1');
    expect(rows[2]!.isFolder).toBe(true);
    expect(rows[3]!.parentId).toBe('chrome-browser-1.2');
    expect(rows[3]!.url).toBe('https://docs.test');
  });

  it('marks nodes without a url as folders and names them', () => {
    const rows = flattenChromeTree(
      [{ id: '9', title: '', children: [] }] as unknown as chrome.bookmarks.BookmarkTreeNode[],
      'browser',
      'root',
    );
    expect(rows[0]!.isFolder).toBe(true);
    expect(rows[0]!.title).toBe('Untitled folder');
  });
});

describe('bookmarksToTabs', () => {
  it('flattens links into positioned tabs, skipping folders', () => {
    const tree: BookmarkNode[] = [
      node({
        isFolder: true,
        children: [
          node({ url: 'https://a.test', title: 'A' }),
          node({ url: 'https://b.test', title: 'B' }),
        ],
      }),
      node({ url: 'https://c.test', title: 'C' }),
    ];

    const tabs = bookmarksToTabs(tree, 'session-1', 5);
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.url)).toEqual([
      'https://a.test',
      'https://b.test',
      'https://c.test',
    ]);
    expect(tabs.map((t) => t.position)).toEqual([5, 6, 7]);
    expect(tabs.every((t) => t.sessionId === 'session-1')).toBe(true);
    expect(tabs.every((t) => t.chromeTabId === null)).toBe(true);
  });

  it('drops non-portable urls', () => {
    const tabs = bookmarksToTabs(
      [node({ url: 'chrome://settings' }), node({ url: 'https://ok.test' })],
      's',
    );
    expect(tabs.map((t) => t.url)).toEqual(['https://ok.test']);
  });

  it('falls back to the url when the title is empty', () => {
    const [tab] = bookmarksToTabs([node({ url: 'https://x.test', title: '' })], 's');
    expect(tab!.title).toBe('https://x.test');
  });
});
