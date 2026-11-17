import { useMemo, useRef, useState } from 'react';
import type { Book, GlossaryItem } from '../lib/types';
import { ADDRESS_OPTIONS, DEFAULT_TEMPLATE, NAME_OPTIONS, PRESETS } from '../lib/prompt';
import { saveTemplate, testTranslate, type TestResult } from '../lib/actions';
import { useKeys } from '../hooks';
import { useT, type MsgKey } from '../i18n';
import { WizardActions, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { href } from '../router';
import type { StepProps } from './Wizard';

const VARS = ['{the_loai}', '{kieu_ten}', '{xung_ho}', '{bang_thuat_ngu}', '{doan_truoc}'];

function parseCsv(text: string): GlossaryItem[] {
  return text.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((s) => s.trim().replace(/^"|"$/g, '')))
    .filter((r) => r[0] && r[1] && !/^(gốc|source|src|中文)$/i.test(r[0]))
    .map(([src, dst, kind]) => ({ src, dst, kind: kind || '' }));
}

export default function StepPrompt({ book, save, next }: StepProps) {
  const { t } = useT();
  const toast = useToast();
  const { keys } = useKeys();
  const p = book.prompt;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [sample, setSample] = useState(() => book.chapters.find((c) => c.selected)?.index ?? 0);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [newTerm, setNewTerm] = useState<GlossaryItem>({ src: '', dst: '', kind: '' });

  const set = (patch: Partial<Book['prompt']>) => void save({ ...book, prompt: { ...book.prompt, ...patch } });
  const models = useMemo(() => Array.from(new Set(keys.flatMap((k) => k.models || [k.model]))).sort(), [keys]);

  const applyPreset = (id: string) => {
    const pr = PRESETS.find((x) => x.id === id)!;
    set({ preset: id, genre: pr.genre || p.genre, address: ADDRESS_OPTIONS[pr.address], names: NAME_OPTIONS[pr.names] });
  };
  const insertVar = (v: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = p.template.slice(0, s) + v + p.template.slice(e);
    set({ template: val });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + v.length, s + v.length); });
  };
  const setGloss = (g: GlossaryItem[]) => set({ glossary: g });
  const addTerm = () => {
    if (!newTerm.src.trim() || !newTerm.dst.trim()) return;
    setGloss([...p.glossary.filter((g) => g.src !== newTerm.src.trim()), { src: newTerm.src.trim(), dst: newTerm.dst.trim(), kind: newTerm.kind.trim() }]);
    setNewTerm({ src: '', dst: '', kind: '' });
  };
  const exportCsv = () => {
    const csv = 'src,dst,kind\n' + p.glossary.map((g) => [g.src, g.dst, g.kind].map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'glossary.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try { setTest(await testTranslate(book, sample)); } catch (e: any) {
      toast(e?.message === 'no_keys' ? t('err.no_keys') : String(e?.message || e), 'err');
    } finally { setTesting(false); }
  };

  const sel = (label: MsgKey, value: string, options: [string, string][], onChange: (v: string) => void) => (
    <label style={{ flex: '1 1 180px' }}><span className="label">{t(label)}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '999 1 560px', minWidth: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 className="h2">{t('pr.prompt')}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn sm" onClick={() => { saveTemplate(p); toast(t('pr.tplSaved')); }}>{t('pr.saveTpl')}</button>
              <button className="btn sm" onClick={() => set({ template: DEFAULT_TEMPLATE })}>{t('pr.reset')}</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {sel('pr.preset', p.preset, PRESETS.map((x) => [x.id, t(`pr.preset.${x.id}` as MsgKey)]), applyPreset)}
            {sel('pr.address', p.address, ADDRESS_OPTIONS.map((x) => [x, x]), (v) => set({ address: v }))}
            {sel('pr.names', p.names, NAME_OPTIONS.map((x) => [x, x]), (v) => set({ names: v }))}
          </div>
          <label><span className="label">{t('pr.genre')}</span>
            <input className="input" value={p.genre} onChange={(e) => set({ genre: e.target.value, preset: 'custom' })} /></label>
          <label><span className="label">{t('pr.content')}</span>
            <textarea ref={taRef} className="input mono" rows={12} style={{ fontSize: 13 }} value={p.template} onChange={(e) => set({ template: e.target.value })} spellCheck={false} /></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span className="hint" style={{ marginRight: 4 }}>{t('pr.vars')}</span>
            {VARS.map((v) => <button key={v} type="button" className="var" onClick={() => insertVar(v)}>{v}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 10, background: 'var(--card2)', color: 'var(--text3)' }}>
            <Icon name="lock" size={16} /><span className="hint">{t('pr.locked')}</span>
          </div>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text2)', minHeight: 32 }}>{t('pr.advanced')}</summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
              <label style={{ flex: '2 1 220px' }}><span className="label">{t('pr.model')}</span>
                <select className="input" value={p.model} onChange={(e) => set({ model: e.target.value })}>
                  <option value="">{t('pr.modelAuto')}</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
              <label style={{ flex: '1 1 140px' }}><span className="label">{t('pr.chunk')}</span>
                <input className="input mono" type="number" min={500} max={20000} step={500} value={p.chunkChars} onChange={(e) => set({ chunkChars: Math.max(500, Number(e.target.value) || 2500) })} /></label>
              <label style={{ flex: '1 1 140px' }}><span className="label">{t('pr.temp')}</span>
                <input className="input mono" type="number" min={0} max={2} step={0.1} value={p.temperature} onChange={(e) => set({ temperature: Math.min(2, Math.max(0, Number(e.target.value))) })} /></label>
            </div>
          </details>
        </section>

        <section className="card" style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 18px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 className="h2">{t('pr.gloss', { n: p.glossary.length })}</h2>
            <span className="hint">{t('pr.glossSub')}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => csvRef.current?.click()}>{t('pr.csv')}</button>
              <button className="btn sm" onClick={exportCsv} disabled={!p.glossary.length}>{t('pr.csvExport')}</button>
              <input ref={csvRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                const items = parseCsv(await f.text());
                const map = new Map(p.glossary.map((g) => [g.src, g]));
                for (const it of items) map.set(it.src, it);
                setGloss([...map.values()]);
              }} />
            </div>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>{t('pr.col.src')}</th><th>{t('pr.col.dst')}</th><th>{t('pr.col.kind')}</th><th /></tr></thead>
              <tbody>
                {p.glossary.map((g, i) => (
                  <tr key={g.src + i}>
                    <td className="zh" style={{ fontWeight: 600 }}>{g.src}</td>
                    <td><input className="input" style={{ minHeight: 36, padding: '4px 10px' }} value={g.dst} aria-label={g.src} onChange={(e) => setGloss(p.glossary.map((x, j) => (j === i ? { ...x, dst: e.target.value } : x)))} /></td>
                    <td><span className="chip mute plain">{g.kind || '—'}</span></td>
                    <td style={{ width: 48 }}><button className="iconbtn sm" aria-label={`${t('common.delete')} ${g.src}`} onClick={() => setGloss(p.glossary.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 18px 18px', borderTop: '1px solid var(--line2)' }} onSubmit={(e) => { e.preventDefault(); addTerm(); }}>
            <input className="input zh" style={{ flex: '1 1 90px', minHeight: 40 }} placeholder="中文" aria-label={t('pr.col.src')} value={newTerm.src} onChange={(e) => setNewTerm({ ...newTerm, src: e.target.value })} />
            <input className="input" style={{ flex: '1 1 110px', minHeight: 40 }} placeholder="Tiếng Việt" aria-label={t('pr.col.dst')} value={newTerm.dst} onChange={(e) => setNewTerm({ ...newTerm, dst: e.target.value })} />
            <input className="input" style={{ flex: '1 1 90px', minHeight: 40 }} placeholder={t('pr.kindPh')} aria-label={t('pr.col.kind')} value={newTerm.kind} onChange={(e) => setNewTerm({ ...newTerm, kind: e.target.value })} />
            <button className="btn sm" type="submit" disabled={!newTerm.src.trim() || !newTerm.dst.trim()}><Icon name="plus" size={16} />{t('common.add')}</button>
          </form>
        </section>
      </div>

      <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: '1 1 260px' }}><h2 className="h2">{t('pr.test')}</h2><span className="hint">{t('pr.testSub')}</span></div>
          <label style={{ flex: '0 1 340px' }}><span className="label">{t('pr.sample')}</span>
            <select className="input zh" value={sample} onChange={(e) => setSample(Number(e.target.value))}>
              {book.chapters.filter((c) => c.chars > 0).map((c) => <option key={c.index} value={c.index}>{t('pr.sampleN', { t: c.title })}</option>)}
            </select></label>
          <button className="btn pri" onClick={() => void runTest()} disabled={testing}>{testing ? <span className="spin" /> : <Icon name="play" size={16} />}{testing ? t('pr.testing') : t('pr.test')}</button>
        </div>
        {test ? (
          <>
            <div className="pairs">
              <span className="label" style={{ margin: 0 }}>{t('common.original')}</span><span className="label" style={{ margin: 0 }}>{t('common.translation')}</span>
              {test.items.map((it) => (
                <div key={it.id} style={{ display: 'contents' }}>
                  <div className="src zh">{it.text}</div>
                  <div className="src" style={{ color: 'var(--text)' }}>{test.result[it.id]}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span className="chip ok">OK</span>
              <span className="hint">{t('pr.testDone', { tok: test.tokens, s: (test.ms / 1000).toFixed(1), k: test.keyLabel })}</span>
            </div>
          </>
        ) : <p className="hint" style={{ margin: 0 }}>{t('pr.testEmpty')}</p>}
      </section>
      <WizardActions back={href(`/wizard/${book.id}/2`)} onNext={() => void next()} />
    </>
  );
}
