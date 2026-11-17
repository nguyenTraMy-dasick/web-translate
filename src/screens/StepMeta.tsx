import { useEffect, useRef, useState } from 'react';
import * as db from '../lib/db';
import type { Book, BookMeta } from '../lib/types';
import { getCover, slugify, translateShort } from '../lib/actions';
import { useT } from '../i18n';
import { Banner, Toggle, WizardActions, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { href } from '../router';
import type { StepProps } from './Wizard';

export default function StepMeta({ book, save, next }: StepProps) {
  const { t } = useT();
  const toast = useToast();
  const m = book.meta;
  const o = book.original;
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let url: string | null = null;
    void getCover(book).then((b) => { if (b) { url = URL.createObjectURL(b); setCover(url); } else setCover(null); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [book.id, book.coverOverride]);

  const set = (patch: Partial<BookMeta>) => void save({ ...book, meta: { ...book.meta, ...patch } });
  const setOpt = (patch: Partial<Book['options']>) => void save({ ...book, options: { ...book.options, ...patch } });

  const tr = async (field: 'title' | 'creator' | 'description') => {
    const src = o[field];
    if (!src) return;
    setBusy(field);
    try {
      const v = await translateShort(book, src, field);
      const patch: Partial<BookMeta> = { [field]: v };
      if (field === 'title') patch.fileName = `${slugify(v)}_vi.epub`;
      set(patch);
    } catch (e: any) {
      toast(t('meta.trFail', { e: e?.message === 'no_keys' ? t('err.no_keys') : String(e?.message || e) }), 'err');
    } finally { setBusy(null); }
  };

  const onCover = async (f?: File) => {
    if (!f || !f.type.startsWith('image/')) return;
    await db.putFile(`${book.id}:cover`, f);
    await save({ ...book, coverOverride: { mime: f.type } });
  };
  const resetCover = async () => {
    await db.deleteFile(`${book.id}:cover`);
    const b = structuredClone(book);
    delete b.coverOverride;
    await save(b);
  };
  const restore = () => set({
    title: o.title, creator: o.creator, description: o.description, publisher: o.publisher, subjects: [...o.subjects],
    fileName: `${slugify(o.title || 'book')}_vi.epub`,
  });

  const field = (label: string, key: 'title' | 'creator' | 'translator' | 'publisher' | 'fileName', opts: { orig?: string; tr?: 'title' | 'creator'; ph?: string; mono?: boolean } = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <label className="label" style={{ margin: 0 }} htmlFor={`f-${key}`}>{label}</label>
      <span style={{ display: 'flex', gap: 8 }}>
        <input id={`f-${key}`} className={`input${opts.mono ? ' mono' : ''}`} value={m[key]} placeholder={opts.ph} onChange={(e) => set({ [key]: e.target.value })} />
        {opts.tr && (
          <button className="btn sm" style={{ flex: 'none' }} onClick={() => void tr(opts.tr!)} disabled={!!busy || !o[opts.tr]}>
            {busy === opts.tr ? <span className="spin" /> : <Icon name="spark" size={16} />}{t('meta.tr')}
          </button>
        )}
      </span>
      {opts.orig && <span className="hint">{t('meta.orig')} <span className="zh">{opts.orig}</span></span>}
    </div>
  );

  return (
    <>
      <Banner>{t('meta.note')}</Banner>
      <section className="card" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', gap: 28 }}>
        <div style={{ flex: '0 0 220px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="label" style={{ margin: 0 }}>{t('meta.cover')}</span>
          <div style={{ width: 220, height: 310, borderRadius: 12, background: 'var(--card2)', border: '1px solid var(--line2)', display: 'grid', placeItems: 'center', overflow: 'hidden', color: 'var(--text2)' }}>
            {cover ? <img src={cover} alt={t('meta.cover')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span className="zh" style={{ writingMode: 'vertical-rl', fontSize: 28, fontWeight: 800, letterSpacing: '0.3em' }}>{(o.title || '').slice(0, 6)}</span>}
          </div>
          <span className="hint">{book.coverOverride ? '' : o.coverHref ? t('meta.coverOrig') : t('meta.coverNone')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" style={{ flex: 1 }} onClick={() => coverRef.current?.click()} disabled={!o.coverHref}><Icon name="image" size={16} />{t('meta.coverChange')}</button>
            <button className="btn sm" style={{ flex: 1 }} onClick={() => void resetCover()} disabled={!book.coverOverride}>{t('meta.coverReset')}</button>
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void onCover(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
        <div style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="chip info">{t('meta.auto')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text2)' }}>
                <Toggle on={book.options.autoMeta} label={t('meta.autoTr')} onChange={(v) => setOpt({ autoMeta: v })} />{t('meta.autoTr')}
              </span>
              <button className="btn sm" onClick={restore}><Icon name="refresh" size={16} />{t('meta.restore')}</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {field(t('meta.f.title'), 'title', { orig: o.title, tr: 'title' })}
            {field(t('meta.f.creator'), 'creator', { orig: o.creator, tr: 'creator' })}
            {field(t('meta.f.translator'), 'translator', { ph: t('meta.f.translatorPh') })}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="label" style={{ margin: 0 }}>{t('meta.f.lang')}</span>
              <select className="input" value={m.language} onChange={(e) => set({ language: e.target.value })}>
                <option value="vi">vi — Tiếng Việt</option>
                <option value={o.language || 'zh'}>{o.language || 'zh'} — {t('common.original')}</option>
              </select></label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="label" style={{ margin: 0 }}>{t('meta.f.subjects')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {m.subjects.map((s) => (
                  <button key={s} className="chip mute plain" style={{ cursor: 'pointer', border: '1px solid var(--line2)' }} aria-label={`${t('common.delete')} ${s}`}
                    onClick={() => set({ subjects: m.subjects.filter((x) => x !== s) })}>{s} ×</button>
                ))}
                <form style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); const v = subject.trim(); if (v && !m.subjects.includes(v)) set({ subjects: [...m.subjects, v] }); setSubject(''); }}>
                  <input className="input" style={{ minHeight: 36, width: 180 }} placeholder={t('meta.f.subjectPh')} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t('meta.f.subjectPh')} />
                  <button className="btn sm" type="submit"><Icon name="plus" size={16} />{t('common.add')}</button>
                </form>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <label className="label" style={{ margin: 0 }} htmlFor="f-desc">{t('meta.f.desc')}</label>
                <button className="btn sm" onClick={() => void tr('description')} disabled={!!busy || !o.description}>{busy === 'description' ? <span className="spin" /> : <Icon name="spark" size={16} />}{t('meta.trDesc')}</button>
              </span>
              <textarea id="f-desc" className="input" rows={4} value={m.description} onChange={(e) => set({ description: e.target.value })} />
              {o.description && <span className="hint">{t('meta.orig')} <span className="zh">{o.description}</span></span>}
            </div>
            {field(t('meta.f.publisher'), 'publisher')}
            {field(t('meta.f.file'), 'fileName', { mono: true })}
          </div>
        </div>
      </section>
      <WizardActions back={href(`/wizard/${book.id}/3`)} onNext={() => void next()}
        extra={<button className="btn" onClick={() => void next()}>{t('common.skip')}</button>} />
    </>
  );
}
