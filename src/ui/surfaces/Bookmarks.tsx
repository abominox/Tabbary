import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { useSessions } from '@/hooks/useSessions';
import { sendMessage } from '@/messaging/bus';
import { cn } from '@/lib';
import { t, tn } from '@/lib/i18n';
import { isPortableUrl } from '@/lib/bundle';
import type { Bookmark } from '@/models';
import { hostnameOf } from '@/lib/tabmark';

type Scope = 'session' | 'tag' | 'browser';

interface Node extends Bookmark {
  children: Node[];
}

function buildTree(rows: Bookmark[], parentId: string | null): Node[] {
  return rows
    .filter((b) => (b.parentId ?? null) === parentId)
    .sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.position - b.position;
    })
    .map((b) => ({ ...b, children: b.isFolder ? buildTree(rows, b.id) : [] }));
}

function countLinks(nodes: Node[]): number {
  return nodes.reduce((n, node) => n + (node.isFolder ? countLinks(node.children) : 1), 0);
}

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: 'session', label: 'bm_scope_session', hint: 'bm_scope_session_hint' },
  { id: 'tag', label: 'bm_scope_tags', hint: 'bm_scope_tags_hint' },
  { id: 'browser', label: 'bm_scope_browser', hint: 'bm_scope_browser_hint' },
];

/**
 * Bookmarks surface.
 *
 * Session bookmarks die with their session; tag bookmarks are shared by every
 * session carrying the tag; browser bookmarks are an import (read-only).
 */
export function Bookmarks() {
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const tags = useStore((s) => s.tags);
  const [scope, setScope] = useState<Scope>('session');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [rows, setRows] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Default owner per scope.
  useEffect(() => {
    if (scope === 'session') {
      const first = sessions.find((s) => s.state === 'active') ?? sessions[0];
      setOwnerId(first?.id ?? null);
    } else if (scope === 'tag') {
      setOwnerId(tags[0]?.name ?? null);
    } else {
      setOwnerId(null);
    }
  }, [scope, sessions.length, tags.length]);

  const load = async () => {
    if (scope !== 'browser' && !ownerId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const list = await sendMessage({
        type: 'bookmarksList',
        scope,
        ownerId: scope === 'browser' ? null : ownerId,
      });
      setRows(Array.isArray(list) ? list : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, ownerId, sessions.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const tree = useMemo(() => buildTree(rows, null), [rows]);
  const totalLinks = countLinks(tree);

  const ownerLabel =
    scope === 'session'
      ? sessions.find((s) => s.id === ownerId)?.name?.trim() || 'Untitled session'
      : scope === 'tag'
        ? `#${ownerId ?? '—'}`
        : 'Chrome bookmarks';

  const add = async () => {
    const url = newUrl.trim();
    if (!url || !isPortableUrl(url)) {
      setToast('Enter a full http(s) URL');
      return;
    }
    const created = await sendMessage({
      type: 'bookmarkAdd',
      scope,
      ownerId: scope === 'browser' ? null : ownerId,
      title: newTitle.trim() || url,
      url,
    });
    if (!created) {
      setToast('Could not add that bookmark');
      return;
    }
    setNewTitle('');
    setNewUrl('');
    setAdding(false);
    setToast('Bookmark added');
    await load();
  };

  const addFolder = async () => {
    if (scope === 'browser') return;
    const created = await sendMessage({
      type: 'bookmarkAdd',
      scope,
      ownerId,
      title: 'New folder',
      isFolder: true,
    });
    if (created) {
      setRenaming(created.id);
      setDraft(created.title);
      await load();
    }
  };

  const rename = async (id: string) => {
    const title = draft.trim();
    setRenaming(null);
    if (!title) return;
    await sendMessage({ type: 'bookmarkUpdate', id, title });
    await load();
  };

  const remove = async (node: Node) => {
    const count = node.isFolder ? countLinks([node]) + 1 : 1;
    if (!window.confirm(`Delete “${node.title}”${node.isFolder ? ` and its ${count - 1} link(s)` : ''}?`)) {
      return;
    }
    await sendMessage({ type: 'bookmarkDelete', id: node.id });
    setToast('Deleted');
    await load();
  };

  const openAsSession = async (folderId: string | null) => {
    const result = await sendMessage({
      type: 'bookmarksOpen',
      scope,
      ownerId: scope === 'browser' ? null : ownerId,
      folderId,
      name: scope === 'browser' ? 'Imported bookmarks' : `From ${ownerLabel}`,
    });
    if (result) {
      setToast(`Created a session with ${result.tabCount} tabs`);
      await useStore.getState().onSessionsChanged();
    } else {
      setToast('No links here to open');
    }
  };

  const importChrome = async () => {
    try {
      const granted = await chrome.permissions.request({ permissions: ['bookmarks'] });
      if (!granted) {
        setToast('Chrome did not grant bookmark access');
        return;
      }
      const result = await sendMessage({ type: 'bookmarksImport' });
      setToast(`Imported ${result?.imported ?? 0} bookmarks`);
      await load();
    } catch (err) {
      setToast((err as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-surface-border px-4 py-2.5">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            {tn('bm_link_one', 'bm_link_other', totalLinks, [totalLinks])} ·{' '}
            {tn('bm_item_one', 'bm_item_other', rows.length, [rows.length])}
          </p>
          <h1 className="text-base font-semibold tracking-tight text-text-primary">{t('bm_title')}</h1>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void openAsSession(null)}
            className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            {t('bm_open_all')}
          </button>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700"
          >
            {t('bm_add')}
          </button>
        </div>
      </header>

      {/* Scope tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-surface-border px-4 py-1.5">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScope(s.id)}
            aria-pressed={scope === s.id}
            title={t(s.hint)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-medium',
              scope === s.id
                ? 'bg-surface-hover text-text-primary'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            {t(s.label)}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5">
          {scope === 'session' && (
            <select
              value={ownerId ?? ''}
              onChange={(e) => setOwnerId(e.target.value || null)}
              aria-label={t('bm_scope_session')}
              className="max-w-[220px] rounded-md border border-surface-border bg-surface-base px-2 py-1 text-[11px] text-text-primary"
            >
              {sessions.length === 0 && <option value="">{t('bm_no_sessions')}</option>}
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name?.trim() || t('common_untitled')} ({s.state})
                </option>
              ))}
            </select>
          )}
          {scope === 'tag' && (
            <select
              value={ownerId ?? ''}
              onChange={(e) => setOwnerId(e.target.value || null)}
              aria-label={t('bm_scope_tags')}
              className="max-w-[220px] rounded-md border border-surface-border bg-surface-base px-2 py-1 text-[11px] text-text-primary"
            >
              {tags.length === 0 && <option value="">{t('bm_no_tags')}</option>}
              {tags.map((tag) => (
                <option key={tag.id} value={tag.name}>
                  #{tag.name}
                </option>
              ))}
            </select>
          )}
          {scope === 'browser' && (
            <button
              type="button"
              onClick={importChrome}
              className="rounded-md border border-surface-border px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              {t('bm_import_chrome')}
            </button>
          )}
          {scope !== 'browser' && (
            <button
              type="button"
              onClick={addFolder}
              className="rounded-md border border-surface-border px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              {t('bm_new_folder')}
            </button>
          )}
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="shrink-0 border-b border-surface-border bg-surface-elevated px-4 py-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="flex flex-wrap items-center gap-1.5"
          >
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('bm_title_placeholder')}
              aria-label={t('bm_title_label')}
              className="w-48 rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-[11px] outline-none focus:border-accent-500"
            />
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder={t('bm_url_placeholder')}
              aria-label={t('bm_url_label')}
              className="min-w-[240px] flex-1 rounded-md border border-surface-border bg-surface-base px-2 py-1.5 font-mono text-[11px] outline-none focus:border-accent-500"
            />
            <button
              type="submit"
              className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white"
            >
              {t('bm_save')}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] text-text-secondary"
            >
              {t('common_cancel')}
            </button>
          </form>
        </div>
      )}

      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading && <p className="p-3 text-[11px] text-text-muted">{t('common_loading')}</p>}

        {!loading && rows.length === 0 && (
          <div className="grid place-items-center p-10 text-center">
            <div className="max-w-sm">
              <p className="text-sm font-medium text-text-primary">
                {scope === 'browser' ? t('bm_empty_browser_title') : t('bm_empty_title')}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {scope === 'browser'
                  ? t('bm_empty_browser_body')
                  : scope === 'session'
                    ? t('bm_empty_session_body')
                    : t('bm_empty_tag_body')}
              </p>
              {scope === 'browser' && (
                <button
                  type="button"
                  onClick={importChrome}
                  className="mt-3 rounded-md bg-accent-600 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  {t('bm_import_chrome')}
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && tree.length > 0 && (
          <ul className="space-y-0.5">
            {tree.map((node) => (
              <BookmarkBranch
                key={node.id}
                node={node}
                depth={0}
                readOnly={scope === 'browser'}
                renaming={renaming}
                draft={draft}
                onDraft={setDraft}
                onStartRename={(n) => {
                  setRenaming(n.id);
                  setDraft(n.title);
                }}
                onCommitRename={rename}
                onCancelRename={() => setRenaming(null)}
                onDelete={remove}
                onOpenAsSession={(folderId) => void openAsSession(folderId)}
              />
            ))}
          </ul>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-text-primary px-3 py-1.5 text-[11px] font-medium text-surface-base"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

interface BranchProps {
  node: Node;
  depth: number;
  readOnly: boolean;
  renaming: string | null;
  draft: string;
  onDraft: (v: string) => void;
  onStartRename: (n: Node) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onDelete: (n: Node) => void;
  onOpenAsSession: (folderId: string | null) => void;
}

function BookmarkBranch({
  node,
  depth,
  readOnly,
  renaming,
  draft,
  onDraft,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onOpenAsSession,
}: BranchProps) {
  const [open, setOpen] = useState(depth < 2);
  const isRenaming = renaming === node.id;

  return (
    <li>
      <div
        className="group flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] hover:bg-surface-hover"
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {node.isFolder ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 text-text-muted"
            aria-expanded={open}
            aria-label={open ? t('bm_collapse') : t('bm_expand')}
          >
            <span className="w-3">{open ? '▾' : '▸'}</span>
            <span aria-hidden="true">📁</span>
          </button>
        ) : (
          <span className="ml-[18px] shrink-0 text-[10px] text-text-muted" aria-hidden="true">
            ↗
          </span>
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={() => onCommitRename(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename(node.id);
              if (e.key === 'Escape') onCancelRename();
            }}
            aria-label={t('bm_title_label')}
            className="min-w-0 flex-1 rounded border border-accent-500 bg-surface-base px-1 py-0.5 text-[11px] outline-none"
          />
        ) : node.isFolder ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="min-w-0 flex-1 truncate text-left font-medium text-text-primary"
          >
            {node.title}
          </button>
        ) : (
          <a
            href={node.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-text-primary hover:underline"
            title={node.url}
          >
            {node.title}
          </a>
        )}

        {!node.isFolder && (
          <span className="hidden shrink-0 font-mono text-[10px] text-text-muted sm:inline">
            {hostnameOf(node.url ?? '')}
          </span>
        )}

        {node.isFolder && (
          <>
            <span className="shrink-0 font-mono text-[10px] text-text-muted">
              {countLinks(node.children)}
            </span>
            <button
              type="button"
              onClick={() => onOpenAsSession(node.id)}
              className="shrink-0 rounded border border-surface-border px-1.5 py-0.5 text-[9px] text-text-muted opacity-0 hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100"
              title={t('bm_open_folder')}
            >
              {t('bm_open')}
            </button>
          </>
        )}

        {!readOnly && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onStartRename(node)}
              className="rounded px-1 text-[10px] text-text-muted hover:bg-surface-border hover:text-text-primary"
              aria-label={t('bm_rename_label', [node.title])}
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => onDelete(node)}
              className="rounded px-1 text-[10px] text-red-500 hover:bg-surface-border"
              aria-label={t('bm_delete_label', [node.title])}
            >
              ✕
            </button>
          </span>
        )}
      </div>

      {node.isFolder && open && node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <BookmarkBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              readOnly={readOnly}
              renaming={renaming}
              draft={draft}
              onDraft={onDraft}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
              onOpenAsSession={onOpenAsSession}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
