import { describe, it, expect } from 'vitest';
import {
  buildBundle,
  parseBundle,
  parseUrlList,
  parseOneTab,
  parseLinkList,
  parseBookmarksHtml,
  detectAndParseImport,
  isPortableUrl,
  BUNDLE_FORMAT,
} from '@/lib/bundle';
import type { Session, Tab, TabGroup } from '@/models';

function session(overrides: Partial<Session> = {}): Session {
  const ts = Date.now();
  return {
    id: 's1',
    name: 'Research',
    windowId: 7,
    state: 'active',
    mode: 'multi-window',
    tags: ['work'],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
    version: 3,
    deleted: false,
    ...overrides,
  };
}

function tab(overrides: Partial<Tab> = {}): Tab {
  const ts = Date.now();
  return {
    id: 't1',
    sessionId: 's1',
    chromeTabId: 99,
    url: 'https://example.com/a',
    title: 'A',
    groupId: null,
    pinned: false,
    position: 0,
    active: false,
    discarded: false,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...overrides,
  };
}

function group(overrides: Partial<TabGroup> = {}): TabGroup {
  const ts = Date.now();
  return {
    id: 'g1',
    sessionId: 's1',
    chromeGroupId: 5,
    title: 'Specs',
    color: 'blue',
    collapsed: false,
    position: 0,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...overrides,
  };
}

describe('isPortableUrl', () => {
  it('accepts web and file URLs', () => {
    expect(isPortableUrl('https://a.test')).toBe(true);
    expect(isPortableUrl('http://a.test')).toBe(true);
    expect(isPortableUrl('file:///tmp/x')).toBe(true);
  });

  it('rejects browser-internal and executable URLs', () => {
    expect(isPortableUrl('chrome://extensions')).toBe(false);
    expect(isPortableUrl('chrome-extension://abc/page.html')).toBe(false);
    expect(isPortableUrl('about:blank')).toBe(false);
    expect(isPortableUrl('javascript:alert(1)')).toBe(false);
    expect(isPortableUrl('devtools://x')).toBe(false);
    expect(isPortableUrl('')).toBe(false);
  });
});

describe('buildBundle', () => {
  it('produces counts and drops non-portable tabs', () => {
    const bundle = buildBundle(
      [session()],
      {
        s1: [
          tab({ id: 't1', url: 'https://a.test', position: 0 }),
          tab({ id: 't2', url: 'chrome://settings', position: 1 }),
        ],
      },
      { s1: [group()] },
    );

    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.counts.sessions).toBe(1);
    expect(bundle.counts.tabs).toBe(1);
    expect(bundle.counts.groups).toBe(1);
    expect(bundle.sessions[0]!.tabs.map((t) => t.url)).toEqual(['https://a.test']);
  });

  it('nulls group references that the session does not own', () => {
    const bundle = buildBundle(
      [session()],
      { s1: [tab({ groupId: 'missing-group' })] },
      { s1: [] },
    );
    expect(bundle.sessions[0]!.tabs[0]!.groupId).toBeNull();
  });

  it('sorts tabs and groups by position', () => {
    const bundle = buildBundle(
      [session()],
      {
        s1: [
          tab({ id: 'b', url: 'https://b.test', position: 2 }),
          tab({ id: 'a', url: 'https://a.test', position: 1 }),
        ],
      },
      { s1: [group({ id: 'g2', position: 1 }), group({ id: 'g1', position: 0 })] },
    );
    expect(bundle.sessions[0]!.tabs.map((t) => t.url)).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
    expect(bundle.sessions[0]!.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('excludes soft-deleted rows via the caller (only live rows are passed)', () => {
    const bundle = buildBundle([session()], { s1: [] }, { s1: [] });
    expect(bundle.sessions[0]!.tabs).toHaveLength(0);
  });
});

describe('parseBundle', () => {
  const good = buildBundle(
    [session()],
    { s1: [tab({ groupId: 'g1' })] },
    { s1: [group()] },
  );

  it('accepts a bundle we produced', () => {
    const result = parseBundle(JSON.parse(JSON.stringify(good)));
    expect(result.ok).toBe(true);
    expect(result.bundle?.sessions).toHaveLength(1);
    expect(result.bundle?.counts.tabs).toBe(1);
  });

  it('rejects a foreign object', () => {
    const result = parseBundle({ hello: 'world' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Not a tabbary export');
  });

  it('rejects a newer format version', () => {
    const result = parseBundle({ ...good, version: 99 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('version 99');
  });

  it('rejects non-objects and missing sessions', () => {
    expect(parseBundle(null).ok).toBe(false);
    expect(parseBundle('x').ok).toBe(false);
    expect(parseBundle({ format: BUNDLE_FORMAT, version: 1 }).ok).toBe(false);
  });

  it('skips sessions that have no restorable tabs, with a warning', () => {
    const result = parseBundle({
      format: BUNDLE_FORMAT,
      version: 1,
      sessions: [
        { id: 'a', tabs: [{ url: 'chrome://settings' }] },
        { id: 'b', tabs: [{ url: 'https://ok.test' }] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.bundle?.sessions).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('no restorable tabs');
  });

  it('repairs dangling group ids and missing fields', () => {
    const result = parseBundle({
      format: BUNDLE_FORMAT,
      version: 1,
      sessions: [
        {
          tabs: [{ url: 'https://ok.test', groupId: 'ghost' }],
          groups: [{ id: 'real' }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    const s = result.bundle!.sessions[0]!;
    expect(s.tabs[0]!.groupId).toBeNull();
    expect(s.groups[0]!.title).toBe('');
    expect(s.groups[0]!.color).toBe('grey');
    expect(s.state).toBe('closed');
  });

  it('forces imported sessions to be closed even if marked active', () => {
    const result = parseBundle({
      ...good,
      sessions: [{ ...good.sessions[0], state: 'active' }],
    });
    // parseBundle normalises the field; importBundle also forces closed.
    expect(result.bundle!.sessions[0]!.state).toBe('active');
  });
});

describe('parseUrlList', () => {
  it('parses one URL per line, ignoring blanks and duplicates', () => {
    const urls = parseUrlList(`
      https://a.test
      https://b.test

      https://a.test
      not a url
    `);
    expect(urls).toEqual(['https://a.test', 'https://b.test']);
  });

  it('takes the first token when a line has extra text', () => {
    expect(parseUrlList('https://a.test Some title')).toEqual(['https://a.test']);
  });
});

describe('parseOneTab', () => {
  it('parses the JSON array format with tab-separated titles', () => {
    const text = JSON.stringify([
      'https://a.test\tTitle A',
      'https://b.test\tTitle B',
    ]);
    const sessions = parseOneTab(text);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tabs.map((t) => t.title)).toEqual(['Title A', 'Title B']);
  });

  it('parses the plain-text format, splitting sessions on blank lines', () => {
    const text = [
      'https://a.test\tTitle A',
      'https://b.test | Title B',
      '',
      'https://c.test',
    ].join('\n');
    const sessions = parseOneTab(text);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.tabs).toHaveLength(2);
    expect(sessions[0]!.tabs[1]!.title).toBe('Title B');
    expect(sessions[1]!.tabs[0]!.url).toBe('https://c.test');
  });

  it('drops non-portable lines', () => {
    const sessions = parseOneTab('chrome://settings\nhttps://ok.test');
    expect(sessions[0]!.tabs.map((t) => t.url)).toEqual(['https://ok.test']);
  });

  it('returns nothing for empty input', () => {
    expect(parseOneTab('   ')).toEqual([]);
  });
});

describe('detectAndParseImport', () => {
  it('detects a tabbary bundle', () => {
    const bundle = buildBundle([session()], { s1: [tab()] }, { s1: [] });
    const result = detectAndParseImport(JSON.stringify(bundle));
    expect(result.source).toBe('tabbary');
    expect(result.sessions).toHaveLength(1);
  });

  it('detects a OneTab export', () => {
    const result = detectAndParseImport('https://a.test\tA\nhttps://b.test\tB');
    expect(result.source).toBe('onetab');
    expect(result.sessions[0]!.tabs).toHaveLength(2);
  });

  it('falls back to a plain URL list', () => {
    const result = detectAndParseImport('https://a.test\nhttps://b.test');
    expect(result.source).toBe('urls');
    expect(result.sessions[0]!.tabs).toHaveLength(2);
  });

  it('reports nothing for unparseable input', () => {
    const result = detectAndParseImport('hello world');
    expect(result.source).toBe('none');
    expect(result.sessions).toHaveLength(0);
  });
});

describe('legacy export tags', () => {
  it('still reads a bundle exported before the rename', () => {
    // A backup taken under the old name must not become unreadable when the
    // product is renamed. Only the tag changed; the shape did not.
    const legacy = {
      format: 'windrow-export',
      version: 1,
      exportedAt: Date.now(),
      generator: 'windrow',
      counts: { sessions: 1, tabs: 1, groups: 0 },
      sessions: [
        {
          id: 's1',
          name: 'Old session',
          state: 'closed',
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          closedAt: 1,
          groups: [],
          tabs: [
            { url: 'https://a.test', title: 'A', pinned: false, position: 0, groupId: null },
          ],
        },
      ],
    };

    const parsed = parseBundle(legacy);
    expect(parsed.ok).toBe(true);
    // `ok` is a boolean field, not a discriminant, so narrow on `bundle` itself.
    expect(parsed.bundle?.sessions).toHaveLength(1);
    expect(parsed.bundle?.sessions[0]?.tabs[0]?.url).toBe('https://a.test');
  });

  it('still writes the current tag', () => {
    expect(BUNDLE_FORMAT).toBe('tabbary-export');
  });

  it('rejects an unrelated format tag', () => {
    expect(parseBundle({ format: 'something-else', version: 1, sessions: [] }).ok).toBe(false);
  });
});

describe('parseLinkList', () => {
  it('reads a bulleted list', () => {
    const tabs = parseLinkList('- https://a.test/1\n* https://a.test/2\n+ https://a.test/3');
    expect(tabs.map((t) => t.url)).toEqual([
      'https://a.test/1',
      'https://a.test/2',
      'https://a.test/3',
    ]);
  });

  it('reads a numbered list', () => {
    const tabs = parseLinkList('1. https://a.test/1\n2) https://a.test/2');
    expect(tabs.map((t) => t.url)).toHaveLength(2);
  });

  it('takes the title from a markdown link', () => {
    const tabs = parseLinkList('- [Spec A](https://a.test/1)\n- [Spec B](https://a.test/2)');
    expect(tabs[0]).toMatchObject({ url: 'https://a.test/1', title: 'Spec A' });
    expect(tabs[1]).toMatchObject({ url: 'https://a.test/2', title: 'Spec B' });
  });

  it('takes a title after a separator', () => {
    expect(parseLinkList('https://a.test | Some title')[0]!.title).toBe('Some title');
    expect(parseLinkList('https://a.test\tTab title')[0]!.title).toBe('Tab title');
  });

  it('drops trailing punctuation and duplicates', () => {
    const tabs = parseLinkList('https://a.test/1.\nhttps://a.test/1');
    expect(tabs).toHaveLength(1);
  });

  it('ignores non-portable URLs', () => {
    const tabs = parseLinkList('chrome://settings\nabout:blank\nhttps://ok.test');
    expect(tabs.map((t) => t.url)).toEqual(['https://ok.test']);
  });

  it('returns nothing for prose with no links', () => {
    expect(parseLinkList('nothing to see here')).toEqual([]);
  });
});

describe('parseBookmarksHtml', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://root.test/loose" ADD_DATE="1700000000">Loose link</A>
    <DT><H3 ADD_DATE="1700000000">Research</H3>
    <DL><p>
        <DT><A HREF="https://a.test/1" ADD_DATE="1700000000">Title A</A>
        <DT><A HREF="https://a.test/2">Title &amp; more</A>
        <DT><H3>Papers</H3>
        <DL><p>
            <DT><A HREF="https://a.test/paper">A paper</A>
        </DL><p>
    </DL><p>
    <DT><H3>Empty folder</H3>
    <DL><p>
    </DL><p>
</DL><p>`;

  it('turns each folder into a session', () => {
    const sessions = parseBookmarksHtml(html);
    const names = sessions.map((s) => s.name);

    expect(names).toContain('Bookmarks');          // loose root bookmarks
    expect(names).toContain('Research');
    expect(names).toContain('Research / Papers');  // nested folder keeps its path
    expect(names).not.toContain('Empty folder');   // nothing to import
  });

  it('keeps titles and decodes entities', () => {
    const research = parseBookmarksHtml(html).find((s) => s.name === 'Research')!;
    expect(research.tabs.map((t) => t.title)).toEqual(['Title A', 'Title & more']);
  });

  it('keeps a nested folder separate from its parent', () => {
    const sessions = parseBookmarksHtml(html);
    const papers = sessions.find((s) => s.name === 'Research / Papers')!;
    expect(papers.tabs.map((t) => t.url)).toEqual(['https://a.test/paper']);
  });

  it('numbers tabs in document order within a session', () => {
    const research = parseBookmarksHtml(html).find((s) => s.name === 'Research')!;
    expect(research.tabs.map((t) => t.position)).toEqual([0, 1]);
  });

  it('skips browser-internal URLs', () => {
    const sessions = parseBookmarksHtml(
      '<DL><DT><H3>X</H3><DL><DT><A HREF="chrome://settings">S</A>' +
        '<DT><A HREF="https://ok.test">OK</A></DL></DL>',
    );
    expect(sessions[0]!.tabs.map((t) => t.url)).toEqual(['https://ok.test']);
  });

  it('returns nothing when the file has no links', () => {
    expect(parseBookmarksHtml('<html><body>no bookmarks</body></html>')).toEqual([]);
  });
});

describe('detectAndParseImport', () => {
  it('recognises a bookmarks HTML file', () => {
    const html = '<DL><DT><H3>Work</H3><DL>' +
      '<DT><A HREF="https://w.test/1">W1</A></DL></DL>';
    const result = detectAndParseImport(html);
    expect(result.source).toBe('bookmarks');
    expect(result.sessions[0]!.tabs.map((t) => t.url)).toEqual(['https://w.test/1']);
  });

  it('reads a bulleted URL list instead of reporting nothing', () => {
    const result = detectAndParseImport('- https://a.test/1\n- https://a.test/2');
    expect(result.source).toBe('urls');
    expect(result.sessions[0]!.tabs).toHaveLength(2);
  });

  it('explains foreign JSON instead of blaming the file', () => {
    // A Session Buddy style file: JSON, has sessions, but not our format.
    const foreign = JSON.stringify({
      version: '3.2.0',
      sessions: [{ name: 'Work', tabs: [{ url: 'https://a.test' }] }],
    });
    const result = detectAndParseImport(foreign);

    expect(result.source).toBe('none');
    expect(result.warnings[0]).toContain('not a tabbary export');
    expect(result.warnings[0]).not.toContain('expected format');
    expect(result.warnings.join(' ')).toContain('bookmarks HTML');
  });

  it('still reports a corrupted JSON file as such', () => {
    const result = detectAndParseImport('{ "format": "tabbary-export", ');
    expect(result.source).toBe('none');
    expect(result.warnings[0]).toContain('could not be parsed');
  });
});
