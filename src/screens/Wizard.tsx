import { useMemo, useState } from 'react';
import * as db from '../lib/db';
import type { Book } from '../lib/types';
import { createBookFromFile, langPair, withLangs } from '../lib/actions';
import { LANGS, estimateTokensFor, langName } from '../lib/langs';
import { useBook } from '../hooks';
import { useT, type MsgKey } from '../i18n';
import { Page, Stepper, Title, WizardActions, fmtBig, fmtNum, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { go, href } from '../router';
import KeysPanel from './KeysPanel';
import StepPrompt from './StepPrompt';
import StepMeta from './StepMeta';
import StepConfirm from './StepConfirm';

export interface StepProps { book: Book; save: (b: Book) => Promise<void>; next: () => Promise<void> }

export default function Wizard({ bookId, step }: { bookId?: string; step: number }) {
  const { t } = useT();
  const { book, save } = useBook(bookId);
  if (bookId && book === undefined) return <Page><p className="hint">{t('common.loading')}</p></Page>;
  if (bookId && book === null) return <Page><p>{t('pg.notFound')}</p></Page>;

  const cur = book ? step : 1;
  const kicker = `${t('wiz.kicker')}${book?.original.title ? ` · ${book.original.title}` : ''}`;
  const titleKey = (['up.title', 'keys.title', 'pr.title', 'meta.title', 'cf.title'] as MsgKey[])[cur - 1];
  const subKey = (['up.sub', 'keys.sub', 'pr.sub', 'meta.sub', 'cf.sub'] as MsgKey[])[cur - 1];

  const next = async () => {
    if (!book) return;
    const n = Math.min(5, cur + 1);
    if ((book.step || 1) < n) await save({ ...book, step: n });
    go(`/wizard/${book.id}/${n}`);
  };

  let body;
  if (!book) body = <UploadStep />;
  else if (cur === 1) body = <UploadStep book={book} save={save} next={next} />;
  else if (cur === 2) body = <KeysStep book={book} next={next} />;
  else if (cur === 3) body = <StepPrompt book={book} save={save} next={next} />;
  else if (cur === 4) body = <StepMeta book={book} save={save} next={next} />;
  else body = <StepConfirm book={book} save={save} next={next} />;

  return (
    <Page>
      <Title kicker={kicker} title={t(titleKey)} sub={t(subKey)} />
      <Stepper cur={cur} bookId={book?.id} maxStep={book ? Math.max(book.step || 1, cur) : 1} />
      {body}
    </Page>
  );
}

// ---------------- Bước 1 ----------------
function UploadStep({ book, save, next }: Partial<StepProps>) {
  const { t, lang } = useT();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [over, setOver] = useState(false);
  const [q, setQ] = useState('');

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.epub$/i.test(f.name)) { toast(t('up.notEpub'), 'err'); return; }
    setLoading(true);
    try {
      const nb = await createBookFromFile(f);
      if (book && book.status === 'draft') await db.deleteBook(book.id);
      go(`/wizard/${nb.id}/1`);
    } catch (e: any) {
      toast(t('up.bad', { e: String(e?.message || e) }), 'err');
    } finally { setLoading(false); }
  };

  const drop = (
    <label className={`drop${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void onFile(e.dataTransfer.files?.[0]); }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--card)', display: 'grid', placeItems: 'center' }}>
        {loading ? <span className="spin" /> : <Icon name="upload" size={26} />}
      </span>
      <span style={{ fontWeight: 700, fontSize: 16 }}>{loading ? t('up.reading') : t('up.drop')}</span>
      <span className="hint">{t('up.or')}</span>
      <span className="btn sm">{t('up.pick')}</span>
      <input type="file" accept=".epub,application/epub+zip" aria-label={t('up.pick')} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <span className="hint">{t('up.only')}</span>
    </label>
  );

  const chapters = book?.chapters || [];
  const selected = chapters.filter((c) => c.selected);
  const totalChars = chapters.reduce((s, c) => s + c.chars, 0);
  const selChars = selected.reduce((s, c) => s + c.chars, 0);
  const visible = useMemo(() => chapters.filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase())), [chapters, q]);

  if (!book || !save || !next) {
    return <div style={{ maxWidth: 560 }}>{drop}</div>;
  }

  const lp = langPair(book);
  const langSel = (label: MsgKey, value: string, onChange: (v: string) => void) => (
    <label><span className="label">{t(label)}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {!LANGS.some((l) => l.code === value) && <option value={value}>{value}</option>}
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l[lang]}</option>)}
      </select>
    </label>
  );
  const setSel = (idx: number[], v: boolean) => {
    const b = structuredClone(book);
    for (const i of idx) if (b.chapters[i].chars > 0) b.chapters[i].selected = v;
    void save(b);
  };
  const allOn = visible.filter((c) => c.chars > 0).every((c) => c.selected);
  const meta: [MsgKey, string, boolean][] = [
    ['up.m.title', book.original.title || '—', true],
    ['up.m.author', book.original.creator || '—', true],
    ['up.m.lang', book.original.language || '—', false],
    ['up.m.chapters', String(chapters.length), false],
    ['up.m.images', t('up.m.imagesKeep', { n: book.original.images }), false],
    ['up.m.chars', `≈ ${fmtBig(totalChars, lang)}`, false],
  ];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--line2)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="file" size={20} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono ellipsis" style={{ fontWeight: 600, fontSize: 13 }} title={book.fileName}>{book.fileName}</div>
                <div className="hint">{(book.fileSize / 1024 / 1024).toFixed(1)} MB · {t('up.read')}</div>
              </div>
              <span className="chip ok">{t('up.valid')}</span>
            </div>
            <dl className="dl">
              {meta.map(([k, v, zh]) => (<div key={k} style={{ display: 'contents' }}><dt>{t(k)}</dt><dd className={zh ? 'zh' : ''}>{v}</dd></div>))}
            </dl>
            <label className="btn sm" style={{ alignSelf: 'flex-start', position: 'relative' }}>
              <Icon name="refresh" size={16} />{t('up.change')}
              <input type="file" accept=".epub,application/epub+zip" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </section>
          <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: 'var(--text3)', display: 'flex' }}><Icon name="globe" size={20} /></span><h2 className="h2">{t('up.lang')}</h2></div>
            {langSel('up.lang.src', lp.src, (v) => void save(withLangs(book, v, lp.tgt)))}
            {book.detectedLang && <span className="chip info plain" style={{ alignSelf: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: '4px 10px' }}>{t('up.lang.detected', { l: langName(book.detectedLang.code, lang), r: book.detectedLang.reason })}</span>}
            {langSel('up.lang.tgt', lp.tgt, (v) => void save(withLangs(book, lp.src, v)))}
            {lp.src.split('-')[0] === lp.tgt.split('-')[0] ? <span className="hint" style={{ color: 'var(--warn)' }}>{t('up.lang.same')}</span> : <span className="hint">{t('up.lang.hint')}</span>}
          </section>
        </div>
        <section className="card" style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '18px 18px 14px' }}>
            <div style={{ flex: '1 1 240px' }}><h2 className="h2">{t('up.toc')}</h2><div className="hint">{t('up.tocSub')}</div></div>
            <label style={{ position: 'relative', flex: '0 1 220px', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 12, color: 'var(--text3)', display: 'flex' }}><Icon name="search" size={16} /></span>
              <input className="input" style={{ paddingLeft: 36, minHeight: 40 }} placeholder={t('up.filter')} aria-label={t('up.filter')} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <button className="btn sm" onClick={() => setSel(visible.map((c) => c.index), !allOn)}>{allOn ? t('up.selectNone') : t('up.selectAll')}</button>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 40 }}><input type="checkbox" className="check" aria-label={t('up.selectAll')} checked={allOn} onChange={(e) => setSel(visible.map((c) => c.index), e.target.checked)} /></th>
                <th>#</th><th>{t('up.col.title')}</th><th style={{ textAlign: 'right' }}>{t('up.col.chars')}</th><th style={{ textAlign: 'right' }}>{t('up.col.tokens')}</th><th>{t('up.col.status')}</th>
              </tr></thead>
              <tbody>
                {visible.map((c) => {
                  const st = c.chars === 0 ? ['mute', t('up.st.empty')] : c.selected ? ['ok', t('up.st.will')] : c.isNav ? ['mute', t('up.st.toc')] : ['mute', t('up.st.off')];
                  return (
                    <tr key={c.index}>
                      <td><input type="checkbox" className="check" aria-label={c.title} checked={c.selected} disabled={c.chars === 0} onChange={(e) => setSel([c.index], e.target.checked)} /></td>
                      <td className="hint mono">{c.index}</td>
                      <td className="zh" style={{ fontWeight: 600 }}>{c.title}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(c.chars, lang)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--text3)' }}>~{fmtBig(estimateTokensFor(c.chars, lp.src), lang)}</td>
                      <td><span className={`chip ${st[0]} plain`}>{st[1]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, padding: '14px 18px', borderTop: '1px solid var(--line2)', background: 'var(--card2)', borderRadius: '0 0 16px 16px' }}>
            <span style={{ fontWeight: 600 }}>{t('up.selected', { a: selected.length, b: chapters.length })}</span>
            <span className="hint">{t('up.estimate', { n: fmtBig(estimateTokensFor(selChars, lp.src), lang) })}</span>
          </div>
        </section>
      </div>
      <WizardActions back={href('/library')} nextDisabled={!selected.length} onNext={() => void next()} />
    </>
  );
}

// ---------------- Bước 2 ----------------
function KeysStep({ book, next }: { book: Book; next: () => Promise<void> }) {
  const { t } = useT();
  const toast = useToast();
  const onNext = async () => {
    const usable = (await db.getKeys()).filter((k) => !k.disabled && k.state !== 'invalid');
    if (!usable.length) toast(t('keys.need'), 'err');
    else await next();
  };
  return (
    <>
      <KeysPanel />
      <WizardActions back={href(`/wizard/${book.id}/1`)} onNext={() => void onNext()} />
    </>
  );
}
