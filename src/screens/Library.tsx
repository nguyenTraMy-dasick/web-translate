import { useEffect, useState } from 'react';
import * as db from '../lib/db';
import type { Book } from '../lib/types';
import { downloadBook } from '../lib/actions';
import { subscribe } from '../lib/runner';
import { useT, type MsgKey } from '../i18n';
import { Banner, Page, Title, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { href } from '../router';

export function statusChip(b: Book, t: (k: MsgKey, v?: Record<string, string | number>) => string): { cls: string; label: string } {
  if (b.status === 'error') {
    if (b.statusDetail === 'no_keys') return { cls: 'err', label: t('status.no_keys') };
    if (b.statusDetail === 'chunk_errors') return { cls: 'err', label: t('status.chunk_errors', { n: b.progress.errors }) };
    return { cls: 'err', label: t('status.error') };
  }
  if (b.status === 'paused' && b.statusDetail === 'interrupted') return { cls: 'warn', label: t('status.interrupted') };
  const map: Record<string, string> = { draft: 'mute', ready: 'mute', running: 'info', paused: 'mute', done: 'ok' };
  return { cls: map[b.status] || 'mute', label: t(`status.${b.status}` as MsgKey) };
}

export default function Library() {
  const { t } = useT();
  const toast = useToast();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'running' | 'done'>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => setBooks(await db.getBooks());
  useEffect(() => { void reload(); }, []);
  useEffect(() => subscribe((m) => { if (m.type === 'state' || m.type === 'progress') void reload(); }), []);

  const list = (books || []).filter((b) => {
    if (filter === 'running' && !['running', 'paused', 'error', 'ready'].includes(b.status)) return false;
    if (filter === 'done' && b.status !== 'done') return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [b.meta.title, b.original.title, b.meta.creator, b.original.creator].some((x) => x?.toLowerCase().includes(s));
  });

  const onDownload = async (b: Book) => {
    setBusy(b.id);
    try { await downloadBook(b); } catch (e: any) { toast(String(e?.message || e), 'err'); }
    setBusy(null);
  };
  const onDelete = async (b: Book) => {
    if (!confirm(t('lib.delete.confirm', { t: b.meta.title || b.original.title }))) return;
    await db.deleteBook(b.id);
    void reload();
  };

  return (
    <Page>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <Title title={t('lib.title')} sub={t('lib.sub')} />
        <a className="btn pri" href={href('/new')}><Icon name="plus" />{t('lib.new')}</a>
      </div>
      <Banner>{t('lib.tabNote')}</Banner>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="seg" role="group" aria-label="Filter">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('common.all')} · {books?.length ?? 0}</button>
          <button className={filter === 'running' ? 'on' : ''} onClick={() => setFilter('running')}>{t('lib.filter.running')}</button>
          <button className={filter === 'done' ? 'on' : ''} onClick={() => setFilter('done')}>{t('lib.filter.done')}</button>
        </div>
        <label style={{ position: 'relative', flex: '0 1 320px', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 14, color: 'var(--text3)', display: 'flex' }}><Icon name="search" /></span>
          <input className="input" style={{ paddingLeft: 42 }} placeholder={t('lib.search')} aria-label={t('lib.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {books && !books.length && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text3)' }}>{t('lib.empty')}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {list.map((b) => {
          const st = statusChip(b, t);
          const pct = b.progress.total ? Math.round((b.progress.done / b.progress.total) * 100) : 0;
          const chSel = b.chapters.filter((c) => c.selected).length;
          const draft = b.status === 'draft';
          let action: { label: string; href?: string; onClick?: () => void };
          if (draft) action = { label: t('lib.act.continue'), href: href(`/wizard/${b.id}/${b.step || 1}`) };
          else if (b.status === 'done') action = { label: t('lib.act.download'), onClick: () => onDownload(b) };
          else if (b.status === 'error' && b.statusDetail === 'no_keys') action = { label: t('lib.act.keys'), href: href('/keys') };
          else if (b.status === 'paused') action = { label: t('lib.act.resume'), href: href(`/book/${b.id}`) };
          else action = { label: t('lib.act.view'), href: href(`/book/${b.id}`) };
          return (
            <article key={b.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 14 }}>
                <a href={href(draft ? `/wizard/${b.id}/${b.step || 1}` : `/book/${b.id}`)} className="zh" aria-hidden="true" tabIndex={-1}
                  style={{ width: 72, height: 104, flex: 'none', borderRadius: 8, background: 'var(--card2)', border: '1px solid var(--line2)', display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', fontSize: 15, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text2)', textDecoration: 'none', overflow: 'hidden' }}>
                  {(b.original.title || '?').slice(0, 6)}
                </a>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
                    <a href={href(draft ? `/wizard/${b.id}/${b.step || 1}` : `/book/${b.id}`)} style={{ textDecoration: 'none' }}>{b.meta.title || b.original.title || b.fileName}</a>
                  </h3>
                  <span className="hint zh">{b.original.title}{b.original.creator ? ` · ${b.original.creator}` : ''}</span>
                  <span className={`chip ${st.cls}`} style={{ alignSelf: 'flex-start', marginTop: 8 }}>{st.label}</span>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                  <span>{chSel} {t('common.chapters')}</span><span style={{ fontWeight: 600 }}>{pct}%</span>
                </div>
                <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {action.href
                  ? <a className="btn sm pri" style={{ flex: 1 }} href={action.href}>{action.label}</a>
                  : <button className="btn sm pri" style={{ flex: 1 }} onClick={action.onClick} disabled={busy === b.id}>{busy === b.id ? <span className="spin" /> : null}{action.label}</button>}
                <button className="iconbtn" style={{ width: 40, height: 40 }} aria-label={`${t('common.delete')} ${b.meta.title}`} title={t('common.delete')} onClick={() => onDelete(b)} disabled={b.status === 'running'}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </Page>
  );
}
