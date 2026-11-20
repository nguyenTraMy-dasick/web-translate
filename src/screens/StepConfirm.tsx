import { useEffect, useState } from 'react';
import * as db from '../lib/db';
import { langPair, prepareChunks } from '../lib/actions';
import { estimateTokensFor, langName } from '../lib/langs';
import { currentRunning, startBook } from '../lib/runner';
import { useKeys } from '../hooks';
import { useT } from '../i18n';
import { Toggle, WizardActions, fmtBig, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { go, href } from '../router';
import type { StepProps } from './Wizard';
import type { Book } from '../lib/types';
import { DEFAULT_MODEL } from '../lib/gemini';

export default function StepConfirm({ book, save }: StepProps) {
  const { t, lang } = useT();
  const toast = useToast();
  const { keys } = useKeys();
  const [busy, setBusy] = useState(false);
  const [conc, setConc] = useState(3);
  useEffect(() => { void db.getSettings().then((s) => setConc(s.concurrency)); }, []);
  const setOpt = (patch: Partial<Book['options']>) => void save({ ...book, options: { ...book.options, ...patch } });

  const sel = book.chapters.filter((c) => c.selected);
  const lp = langPair(book);
  const outLang = book.meta.language || lp.tgt;
  const chars = sel.reduce((s, c) => s + c.chars, 0);
  const usable = keys.filter((k) => !k.disabled && k.state !== 'invalid');
  const models = Array.from(new Set(usable.map((k) => k.model || DEFAULT_MODEL)));

  const start = async () => {
    const running = currentRunning();
    if (running && running !== book.id) { toast(t('cf.busy'), 'err'); return; }
    if (!usable.length) { toast(t('keys.need'), 'err'); go(`/wizard/${book.id}/2`); return; }
    if (!sel.length) { toast(t('up.needChapter'), 'err'); go(`/wizard/${book.id}/1`); return; }
    setBusy(true);
    try {
      const chunks = await prepareChunks(book);
      await save({ ...book, status: 'ready', step: 5, progress: { done: chunks.filter((c) => c.status === 'done').length, total: chunks.length, errors: 0, running: 0 } });
      startBook(book.id);
      go(`/book/${book.id}`);
    } catch (e: any) {
      toast(String(e?.message || e), 'err');
    } finally { setBusy(false); }
  };

  const row = (label: string, hint: string, on: boolean, onChange: (v: boolean) => void, last = false) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderBottom: last ? 0 : '1px solid var(--line2)' }}>
      <span><span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span><br /><span className="hint">{hint}</span></span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
  const summary: [string, string][] = [
    [t('cf.s.book'), book.meta.title || book.original.title],
    [t('cf.s.lang'), `${langName(lp.src, lang)} → ${langName(lp.tgt, lang)}`],
    [t('cf.s.chapters'), `${sel.length} / ${book.chapters.length}`],
    [t('cf.s.tokens'), `≈ ${fmtBig(estimateTokensFor(chars, lp.src), lang)}`],
    [t('cf.s.keys'), `${usable.length} / ${keys.length}`],
    [t('cf.s.model'), book.prompt.model || models.join(', ') || DEFAULT_MODEL],
    [t('cf.s.conc'), t('cf.s.concN', { n: conc })],
  ];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 18, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span className="sdot cur" style={{ width: 30, height: 30 }}><Icon name="check" size={14} /></span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t('cf.out')}</span>
              <span className="hint">{t('cf.outHint', { l: langName(outLang, lang), c: outLang })}</span>
            </div>
          </section>
          <section className="card" style={{ padding: '6px 18px 8px' }}>
            {row(t('cf.toc'), t('cf.tocHint'), book.options.translateToc, (v) => setOpt({ translateToc: v }))}
            {row(t('cf.bi'), t('cf.biHint'), book.options.bilingual, (v) => setOpt({ bilingual: v }))}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 0' }}>
              <span><span style={{ fontWeight: 600, fontSize: 14 }}>{t('cf.unsel')}</span><br /><span className="hint">{t('cf.unselHint')}</span></span>
              <span className="chip mute plain"><Icon name="lock" size={12} />{t('cf.fixed')}</span>
            </div>
          </section>
        </div>
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 className="h2">{t('cf.summary')}</h2>
            <dl className="dl">{summary.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd className="ellipsis" title={v}>{v}</dd></div>)}</dl>
            <button className="btn pri" style={{ width: '100%', minHeight: 52, fontSize: 15 }} onClick={() => void start()} disabled={busy}>
              {busy ? <span className="spin" /> : <Icon name="play" size={18} />}{busy ? t('cf.preparing') : t('cf.start')}
            </button>
          </section>
          <div className="card" role="note" style={{ padding: '14px 16px', display: 'flex', gap: 12, color: 'var(--warn)', background: 'var(--warn-bg)', borderColor: 'transparent' }}>
            <Icon name="warn" size={20} /><span style={{ color: 'var(--text2)', fontSize: 13 }}>{t('cf.warn')}</span>
          </div>
        </div>
      </div>
      <WizardActions back={href(`/wizard/${book.id}/4`)} nextLabel={busy ? t('cf.preparing') : t('cf.start')} nextDisabled={busy} onNext={() => void start()} />
    </>
  );
}
