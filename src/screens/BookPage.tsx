import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../lib/db';
import type { Chunk, LogEntry } from '../lib/types';
import { CH_META, CH_TOC } from '../lib/types';
import { chapterStats, downloadBook } from '../lib/actions';
import { currentRunning, pauseBook, startBook, subscribe } from '../lib/runner';
import { refreshKey } from '../lib/keypool';
import { useBook, useKeys, useNow } from '../hooks';
import { useT, type MsgKey } from '../i18n';
import { Page, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { href } from '../router';
import { statusChip } from './Library';

type Filter = 'all' | 'running' | 'errors';

function fmtDuration(ms: number, lang: string): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return lang === 'vi' ? '< 1 phút' : '< 1 min';
  if (m < 60) return lang === 'vi' ? `${m} phút` : `${m} min`;
  const h = Math.floor(m / 60);
  return lang === 'vi' ? `${h} giờ ${m % 60} phút` : `${h} h ${m % 60} min`;
}

export default function BookPage({ bookId }: { bookId: string }) {
  const { t, lang } = useT();
  const toast = useToast();
  const { book, reload } = useBook(bookId);
  const { keys } = useKeys();
  const now = useNow();
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selCh, setSelCh] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState(false);
  const rate = useRef<{ t0: number; d0: number } | null>(null);

  useEffect(() => {
    void db.getChunks(bookId).then(setChunks);
    void db.getLogs(bookId).then(setLogs);
  }, [bookId]);
  useEffect(() => subscribe((m) => {
    if (m.type === 'chunk' && m.chunk.bookId === bookId) {
      setChunks((cs) => cs.map((c) => (c.id === m.chunk.id ? m.chunk : c)));
    } else if (m.type === 'log' && m.entry.bookId === bookId) {
      setLogs((ls) => [m.entry, ...ls].slice(0, 300));
    } else if (m.type === 'state' && m.bookId === bookId && m.detail === 'busy') {
      toast(t('cf.busy'), 'err');
    }
  }), [bookId]);

  const stats = useMemo(() => (book ? chapterStats(book, chunks) : null), [book, chunks]);
  const doneChunks = chunks.filter((c) => c.status === 'done').length;
  const running = book?.status === 'running';

  // Ước tính thời gian còn lại dựa trên tốc độ từ lúc mở trang
  useEffect(() => {
    if (running && !rate.current) rate.current = { t0: Date.now(), d0: doneChunks };
    if (!running) rate.current = null;
  }, [running, doneChunks]);
  let eta: string | null = null;
  if (running && rate.current && doneChunks > rate.current.d0) {
    const per = (now - rate.current.t0) / (doneChunks - rate.current.d0);
    eta = fmtDuration(per * (chunks.length - doneChunks), lang);
  }

  if (book === undefined) return <Page><p className="hint">{t('common.loading')}</p></Page>;
  if (!book || !stats) return <Page><p>{t('pg.notFound')}</p><a className="btn" href={href('/library')}>{t('pg.breadcrumb')}</a></Page>;

  if (book.status === 'draft' || !chunks.length) {
    return (
      <Page>
        <nav aria-label="Breadcrumb" className="hint"><a href={href('/library')} style={{ color: 'var(--text3)' }}>{t('pg.breadcrumb')}</a> / {book.meta.title}</nav>
        <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <p style={{ margin: 0 }}>{t('pg.notStarted')}</p>
          <a className="btn pri" href={href(`/wizard/${book.id}/${book.step || 1}`)}>{t('pg.goWizard')}<Icon name="right" /></a>
        </div>
      </Page>
    );
  }

  const st = statusChip(book, t);
  const pct = chunks.length ? Math.round((doneChunks / chunks.length) * 100) : 0;
  const errors = chunks.filter((c) => c.status === 'error').length;
  const inflight = chunks.filter((c) => c.status === 'running').length;
  const otherRunning = currentRunning() && currentRunning() !== book.id;

  const resume = () => {
    if (otherRunning) { toast(t('cf.busy'), 'err'); return; }
    startBook(book.id);
  };
  const onDownload = async () => {
    setBuilding(true);
    try { await downloadBook((await db.getBook(book.id))!); } catch (e: any) { toast(String(e?.message || e), 'err'); }
    setBuilding(false);
  };
  const resetChunks = async (list: Chunk[]) => {
    for (const c of list) {
      const n: Chunk = { ...c, status: 'pending', attempts: 0, error: undefined };
      if (c.status === 'done') n.result = undefined;
      await db.putChunk(n);
    }
    setChunks(await db.getChunks(book.id));
    if (!running) resume();
  };

  // ----- danh sách chương (kèm mục lục & thông tin sách nếu có) -----
  type Row = { idx: number; title: string; status: 'done' | 'running' | 'error' | 'pending' | 'partial'; label: string; edited: boolean };
  const rows: Row[] = [];
  const special = (idx: number, title: string) => {
    const cs = chunks.filter((c) => c.chapter === idx);
    if (!cs.length) return;
    const d = cs.filter((c) => c.status === 'done').length;
    const e = cs.some((c) => c.status === 'error');
    const r = cs.some((c) => c.status === 'running');
    rows.push({ idx, title, edited: false, status: e ? 'error' : r ? 'running' : d === cs.length ? 'done' : 'pending', label: e ? t('pg.ch.error') : r ? t('pg.ch.running', { a: d + 1, b: cs.length }) : d === cs.length ? t('pg.ch.done') : t('pg.ch.pending') });
  };
  special(CH_META, t('pg.meta'));
  special(CH_TOC, t('pg.toc'));
  for (const ch of stats.selected) {
    const s = stats.per.get(ch.index)!;
    let status: Row['status'] = 'pending';
    let label = t('pg.ch.pending');
    if (s.error) { status = 'error'; label = t('pg.ch.error'); }
    else if (s.running) { status = 'running'; label = t('pg.ch.running', { a: Math.min(s.total, s.done + 1), b: s.total }); }
    else if (s.done === s.total) { status = 'done'; label = s.edited ? t('pg.ch.edited') : t('pg.ch.done'); }
    else if (s.done) { status = 'partial'; label = t('pg.ch.partial', { a: s.done, b: s.total }); }
    rows.push({ idx: ch.index, title: ch.title, status, label, edited: s.edited });
  }
  const shown = rows.filter((r) => filter === 'all' || (filter === 'errors' ? r.status === 'error' : r.status === 'running'));
  const chipCls: Record<Row['status'], string> = { done: 'ok', running: 'info', error: 'err', pending: 'mute', partial: 'mute' };

  // ----- editor -----
  const edChunks = selCh === null ? [] : chunks.filter((c) => c.chapter === selCh);
  const edTitle = selCh === CH_TOC ? t('pg.toc') : selCh === CH_META ? t('pg.meta') : selCh !== null ? book.chapters[selCh]?.title : '';
  const valueOf = (c: Chunk, id: string) => drafts[`${c.id}|${id}`] ?? c.edited?.[id] ?? c.result?.[id] ?? '';
  const dirty = Object.keys(drafts).length > 0;
  const saveEdits = async () => {
    const byChunk = new Map<string, Chunk>();
    for (const [k, v] of Object.entries(drafts)) {
      const [cid, id] = k.split('|');
      const base = byChunk.get(cid) || structuredClone(chunks.find((c) => c.id === cid)!);
      if (!base) continue;
      base.edited = { ...(base.edited || {}) };
      if (v === (base.result?.[id] ?? '')) delete base.edited[id]; else base.edited[id] = v;
      byChunk.set(cid, base);
    }
    for (const c of byChunk.values()) {
      if (c.status !== 'done' && c.status !== 'running' && c.items.every((it) => (c.edited?.[it.id] ?? c.result?.[it.id] ?? '').trim())) {
        c.status = 'done'; c.error = undefined;
      }
      await db.putChunk(c);
    }
    setDrafts({});
    setChunks(await db.getChunks(book.id));
    const b = await db.getBook(book.id);
    if (b) {
      const all = await db.getChunks(book.id);
      b.progress = { done: all.filter((c) => c.status === 'done').length, total: all.length, errors: all.filter((c) => c.status === 'error').length, running: 0 };
      if (b.status === 'error' && b.statusDetail === 'chunk_errors' && !b.progress.errors && b.progress.done === b.progress.total) { b.status = 'done'; b.statusDetail = undefined; }
      await db.putBook(b);
      void reload();
    }
    toast(t('common.saved'));
  };

  const downloadLog = () => {
    const txt = [...logs].reverse().map((l) => `${new Date(l.at).toISOString()}\t${l.level}\t${l.key || '-'}\t${l.msg}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.download = `${book.meta.fileName.replace(/\.epub$/, '')}.log.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const keyCards = keys.map((k0) => {
    const k = refreshKey({ ...k0 }, now);
    const [cls, label] = k.disabled ? ['err', t('keys.st.disabled')]
      : k.state === 'cooldown' ? ['warn', t('keys.st.cooldown', { s: Math.max(0, Math.ceil((k.cooldownUntil - now) / 1000)) })]
      : k.state === 'quota' ? ['warn', t('keys.st.quota')]
      : k.state === 'invalid' ? ['err', t('keys.st.invalid')]
      : k.state === 'ok' ? ['ok', t('keys.st.ok')] : ['mute', t(`keys.st.${k.state}` as MsgKey)];
    return (
      <div key={k.id} className="card" style={{ flex: '1 1 220px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--text3)' }}><Icon name="key" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }} className="ellipsis">{k.label}</div>
          <div className="hint">{k.usedToday} / {k.rpd || '∞'}</div>
        </div>
        <span className={`chip ${cls}`} title={k.lastError || ''}>{label}</span>
      </div>
    );
  });

  return (
    <Page>
      <nav aria-label="Breadcrumb" className="hint"><a href={href('/library')} style={{ color: 'var(--text3)' }}>{t('pg.breadcrumb')}</a> / {book.meta.title || book.original.title}</nav>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
        <div className="zh" aria-hidden="true" style={{ width: 52, height: 72, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--line2)', display: 'grid', placeItems: 'center', writingMode: 'vertical-rl', fontWeight: 700, fontSize: 12, letterSpacing: '0.15em', color: 'var(--text2)', overflow: 'hidden' }}>{(book.original.title || '').slice(0, 5)}</div>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="h1">{book.meta.title || book.original.title}</h1>
            <span className={`chip ${st.cls}`}>{st.label}</span>
          </div>
          <span className="hint"><span className="zh">{book.original.title}{book.original.creator ? ` · ${book.original.creator}` : ''}</span> · {t('cf.a')}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn" href={href(`/wizard/${book.id}/3`)} aria-disabled={running} onClick={(e) => { if (running) e.preventDefault(); }} style={running ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}><Icon name="settings" size={16} />{t('pg.settings')}</a>
          {running
            ? <button className="btn" onClick={() => pauseBook()}><Icon name="pause" size={16} />{t('pg.pause')}</button>
            : <button className="btn" onClick={resume} disabled={doneChunks === chunks.length && !errors}><Icon name="play" size={16} />{t('pg.resume')}</button>}
          <button className="btn pri" onClick={() => void onDownload()} disabled={building}>{building ? <span className="spin" /> : <Icon name="download" size={16} />}{building ? t('pg.building') : t('pg.download')}</button>
        </div>
      </div>

      <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>{pct}%</span>
          {pct < 100 && <span className="hint">{t('pg.downloadHint')}</span>}
        </div>
        <div className="bar" style={{ height: 10 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 28px', fontSize: 13, color: 'var(--text2)' }}>
          <span>{t('pg.chDone', { a: stats.doneChapters, b: stats.selected.length })}</span>
          {inflight > 0 && <span>{t('pg.running', { n: inflight })}</span>}
          {errors > 0 && <span style={{ color: 'var(--err)' }}>{t('pg.errors', { n: errors })}</span>}
          {eta && <span>{t('pg.eta', { t: eta })}</span>}
        </div>
      </section>

      {keys.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{keyCards}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '1 1 340px', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 className="h2">{t('pg.chapters')}</h2>
            <div className="seg" role="group" aria-label={t('pg.chapters')}>
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('common.all')}</button>
              <button className={filter === 'running' ? 'on' : ''} onClick={() => setFilter('running')}>{t('pg.f.running')}</button>
              <button className={filter === 'errors' ? 'on' : ''} onClick={() => setFilter('errors')}>{t('pg.f.errors', { n: rows.filter((r) => r.status === 'error').length })}</button>
            </div>
          </div>
          <ul className="chlist" style={{ margin: 0, padding: 0, maxHeight: 640, overflowY: 'auto' }}>
            {shown.map((r) => (
              <li key={r.idx}>
                <button className={`row${selCh === r.idx ? ' sel' : ''}`} onClick={() => { if (dirty && !confirm('Discard unsaved edits?')) return; setDrafts({}); setSelCh(r.idx); }}>
                  <span className="hint mono" style={{ width: 26, flex: 'none' }}>{r.idx >= 0 ? r.idx : '·'}</span>
                  <span className="zh ellipsis" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{r.title}</span>
                  <span className={`chip ${chipCls[r.status]}`}>{r.label}</span>
                </button>
                {r.status === 'error' && (
                  <div style={{ display: 'flex', gap: 6, padding: '0 18px 12px 54px' }}>
                    <button className="btn sm" onClick={() => void resetChunks(chunks.filter((c) => c.chapter === r.idx && c.status === 'error'))}><Icon name="refresh" size={14} />{t('pg.retry')}</button>
                    <button className="btn sm" onClick={() => { setDrafts({}); setSelCh(r.idx); }}><Icon name="edit" size={14} />{t('pg.editHand')}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" style={{ flex: '999 1 560px', minWidth: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {selCh === null ? <p className="hint" style={{ margin: 0 }}>{t('pg.selectCh')}</p> : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}><h2 className="h2">{t('pg.review')} · <span className="zh">{edTitle}</span></h2><span className="hint">{t('pg.reviewHint')}</span></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn sm" onClick={() => { if (confirm(t('pg.retranslateConfirm'))) void resetChunks(edChunks); }}><Icon name="refresh" size={16} />{t('pg.retranslate')}</button>
                  <button className="btn sm pri" onClick={() => void saveEdits()} disabled={!dirty}>{t('common.save')}</button>
                </div>
              </div>
              <div className="pairs">
                <span className="label" style={{ margin: 0 }}>{t('common.original')}</span><span className="label" style={{ margin: 0 }}>{t('common.translation')}</span>
                {edChunks.flatMap((c) => [
                  ...(c.status === 'error' ? [<div key={c.id + 'err'} style={{ gridColumn: '1 / -1', color: 'var(--err)', fontSize: 13 }}>
                    {c.error === 'safety' ? t('pg.chunkErr.safety') : `${t('common.error')}: ${c.error}`}</div>] : []),
                  ...c.items.map((it) => {
                    const v = valueOf(c, it.id);
                    const edited = c.edited?.[it.id] !== undefined;
                    return (
                      <div key={c.id + it.id} style={{ display: 'contents' }}>
                        <div className="src zh">{it.text}</div>
                        <div style={{ position: 'relative' }}>
                          <textarea className="input" aria-label={`${t('common.translation')} ${it.id}`} rows={Math.min(12, Math.ceil(Math.max(v.length, it.text.length * 1.6) / 46) + 1)}
                            style={{ lineHeight: 1.7, paddingRight: edited ? 110 : 14, borderColor: c.status === 'error' && !v ? 'var(--err)' : undefined }}
                            placeholder={c.status === 'running' ? '…' : t('pg.untranslated')} value={v}
                            onChange={(e) => setDrafts((d) => ({ ...d, [`${c.id}|${it.id}`]: e.target.value }))} />
                          {edited && <span className="chip warn plain" style={{ position: 'absolute', top: 8, right: 8 }}>{t('pg.edited')}</span>}
                        </div>
                      </div>
                    );
                  }),
                ])}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card" style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h2 className="h2">{t('pg.log')}</h2>
          <button className="btn sm" onClick={downloadLog} disabled={!logs.length}>{t('pg.logDownload')}</button>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text2)', maxHeight: 260, overflowY: 'auto' }}>
          {logs.slice(0, 120).map((l) => (
            <div key={l.id ?? l.at} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', padding: '5px 0' }}>
              <span style={{ color: 'var(--text3)' }}>{new Date(l.at).toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-US')}</span>
              <span style={{ width: 90, fontWeight: 500 }} className="ellipsis">{l.key || '—'}</span>
              <span style={{ flex: '1 1 240px', color: l.level === 'ok' ? 'var(--text2)' : l.level === 'info' ? 'var(--text3)' : `var(--${l.level})` }}>{l.msg}</span>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
