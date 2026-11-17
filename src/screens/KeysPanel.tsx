import { useEffect, useRef, useState } from 'react';
import * as db from '../lib/db';
import type { ApiKey, Settings } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import { maskKey, refreshKey, today } from '../lib/keypool';
import { testKey } from '../lib/actions';
import { DEFAULT_MODEL } from '../lib/gemini';
import { useKeys, useNow } from '../hooks';
import { useT } from '../i18n';
import { Toggle, useToast } from '../ui/common';
import { Icon } from '../ui/icons';

function keyStatus(k: ApiKey, now: number, t: ReturnType<typeof useT>['t']): { cls: string; label: string } {
  refreshKey(k, now);
  if (k.disabled) return { cls: 'err', label: k.state === 'invalid' ? `${t('keys.st.invalid')} · ${t('keys.st.disabled')}` : t('keys.st.disabled') };
  switch (k.state) {
    case 'ok': return { cls: 'ok', label: t('keys.st.ok') };
    case 'untested': return { cls: 'mute', label: t('keys.st.untested') };
    case 'cooldown': return { cls: 'warn', label: t('keys.st.cooldown', { s: Math.max(0, Math.ceil((k.cooldownUntil - now) / 1000)) }) };
    case 'quota': return { cls: 'warn', label: t('keys.st.quota') };
    case 'invalid': return { cls: 'err', label: t('keys.st.invalid') };
    default: return { cls: 'err', label: t('keys.st.error') };
  }
}

export default function KeysPanel() {
  const { t } = useT();
  const toast = useToast();
  const { keys, reload } = useKeys();
  const now = useNow();
  const [label, setLabel] = useState('');
  const [raw, setRaw] = useState('');
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void db.getSettings().then(setSettings); }, []);
  const saveSettings = async (patch: Partial<Settings>) => {
    const s = { ...settings, ...patch };
    setSettings(s);
    await db.putSettings(s);
  };

  const runTest = async (k: ApiKey) => {
    setTesting((s) => new Set(s).add(k.id));
    const r = await testKey({ ...k });
    setTesting((s) => { const n = new Set(s); n.delete(k.id); return n; });
    await reload();
    if (r.state !== 'ok') toast(`${r.label}: ${r.lastError || r.state}`, 'err');
  };

  const add = async () => {
    const list = raw.split(/[\s,;]+/).map((s) => s.trim()).filter((s) => s.length > 20);
    if (!list.length) return;
    const existing = new Set(keys.map((k) => k.key));
    let n = keys.length;
    const added: ApiKey[] = [];
    for (const key of list) {
      if (existing.has(key)) continue;
      n++;
      const k: ApiKey = {
        id: db.uid(), label: list.length === 1 && label.trim() ? label.trim() : `Project ${String.fromCharCode(64 + Math.min(n, 26))}${n > 26 ? n : ''}`,
        key, model: DEFAULT_MODEL, rpm: 10, rpd: 250, usedToday: 0, usedDate: today(), state: 'untested',
        cooldownUntil: 0, disabled: false, createdAt: Date.now() + added.length,
      };
      await db.putKey(k);
      added.push(k);
    }
    setRaw(''); setLabel('');
    await reload();
    for (const k of added) void runTest(k);
  };

  const update = async (k: ApiKey, patch: Partial<ApiKey>) => {
    await db.putKey({ ...k, ...patch });
    await reload();
  };
  const remove = async (k: ApiKey) => {
    if (!confirm(t('keys.delConfirm', { t: k.label }))) return;
    await db.deleteKey(k.id);
    await reload();
  };

  const exportKeys = () => {
    const data = JSON.stringify(keys.map(({ label, key, model, rpm, rpd }) => ({ label, key, model, rpm, rpd })), null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'gemini-keys.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const importKeys = async (f: File) => {
    try {
      const arr = JSON.parse(await f.text());
      if (!Array.isArray(arr)) throw new Error('JSON array expected');
      const existing = new Set(keys.map((k) => k.key));
      let n = 0;
      for (const it of arr) {
        if (!it?.key || existing.has(it.key)) continue;
        await db.putKey({
          id: db.uid(), label: String(it.label || `Key ${keys.length + n + 1}`), key: String(it.key), model: String(it.model || DEFAULT_MODEL),
          rpm: Number(it.rpm) || 10, rpd: Number(it.rpd) || 250, usedToday: 0, usedDate: today(), state: 'untested',
          cooldownUntil: 0, disabled: false, createdAt: Date.now() + n,
        });
        n++;
      }
      toast(t('keys.imported', { n }));
      await reload();
    } catch (e: any) { toast(String(e?.message || e), 'err'); }
  };

  const counts = { ok: 0, cd: 0, bad: 0 };
  for (const k of keys) {
    const s = keyStatus({ ...k }, now, t).cls;
    if (s === 'ok') counts.ok++; else if (s === 'warn') counts.cd++; else if (s === 'err') counts.bad++;
  }
  const numInput = (value: number, onChange: (v: number) => void, aria: string, w = 64) => (
    <input className="input mono" style={{ minHeight: 40, width: w, padding: '0 8px', textAlign: 'center' }} type="number" min={0}
      value={value} aria-label={aria} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: '999 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="h2">{t('keys.add')}</h2>
          <form style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <label style={{ flex: '1 1 160px' }}><span className="label">{t('keys.label')}</span>
              <input className="input" placeholder={t('keys.labelPh')} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
            <label style={{ flex: '3 1 300px' }}><span className="label">{t('keys.key')}</span>
              <textarea className="input mono" rows={1} style={{ minHeight: 44, resize: 'vertical' }} placeholder="AIza…" value={raw} onChange={(e) => setRaw(e.target.value)} autoComplete="off" spellCheck={false} /></label>
            <button className="btn pri" type="submit" disabled={raw.trim().length < 20}><Icon name="plus" />{t('keys.addBtn')}</button>
          </form>
          <span className="hint">{t('keys.addHint')}</span>
        </section>

        <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 18px 8px' }}>
            <div><h2 className="h2">{t('keys.list', { n: keys.length })}</h2>
              <div className="hint">{t('keys.summary', counts)}</div></div>
            <button className="btn sm" onClick={() => keys.forEach((k) => void runTest(k))} disabled={!keys.length}><Icon name="refresh" size={16} />{t('keys.testAll')}</button>
          </div>
          {!keys.length ? (
            <p className="hint" style={{ padding: '8px 18px 20px', margin: 0 }}>{t('keys.empty')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>{t('keys.col.label')}</th><th>{t('keys.col.key')}</th><th>{t('keys.col.model')}</th><th>{t('keys.col.limit')}</th><th>{t('keys.col.state')}</th><th /></tr></thead>
                <tbody>
                  {keys.map((k) => {
                    const st = keyStatus({ ...k }, now, t);
                    const used = k.usedDate === today() ? k.usedToday : 0;
                    const models = k.models?.length ? k.models : [k.model];
                    return (
                      <tr key={k.id}>
                        <td><input className="input" style={{ minHeight: 40, width: 110, fontWeight: 700 }} value={k.label} aria-label={t('keys.col.label')} onChange={(e) => void update(k, { label: e.target.value })} /></td>
                        <td className="mono" style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{maskKey(k.key)}</td>
                        <td>
                          <select className="input" style={{ minHeight: 40, minWidth: 150, maxWidth: 190, padding: '0 8px' }} aria-label={`${t('keys.col.model')} ${k.label}`} value={k.model} onChange={(e) => void update(k, { model: e.target.value })}>
                            {models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </td>
                        <td><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {numInput(k.rpm, (v) => void update(k, { rpm: v }), 'RPM', 56)}<span className="hint">/</span>{numInput(k.rpd, (v) => void update(k, { rpd: v }), 'RPD', 72)}
                        </div></td>
                        <td><div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <span className={`chip ${st.cls}`} title={k.lastError || ''}>{st.label}</span>
                          <span className="hint mono" title={t('keys.col.used')}>{t('keys.col.used')}: {used}/{k.rpd || '∞'}</span>
                        </div></td>
                        <td><div style={{ display: 'flex', gap: 6 }}>
                          {k.disabled
                            ? <button className="btn sm" onClick={() => void update(k, { disabled: false, state: 'untested' }).then(() => runTest({ ...k, disabled: false }))}>{t('keys.enable')}</button>
                            : <button className="btn sm" onClick={() => void runTest(k)} disabled={testing.has(k.id)}>{testing.has(k.id) ? <span className="spin" /> : null}{t('keys.test')}</button>}
                          <button className="iconbtn" style={{ width: 40, height: 40 }} aria-label={`${t('common.delete')} ${k.label}`} onClick={() => void remove(k)}><Icon name="trash" size={16} /></button>
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div style={{ flex: '1 1 290px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="h2">{t('keys.rot')}</h2>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <legend className="label">{t('keys.rot.how')}</legend>
            {([['roundrobin', 'keys.rot.rr', 'keys.rot.rrHint'], ['mostQuota', 'keys.rot.most', 'keys.rot.mostHint']] as const).map(([v, l, h]) => (
              <label key={v} className={`radio-card${settings.rotation === v ? ' on' : ''}`}>
                <input type="radio" name="rot" className="check" checked={settings.rotation === v} onChange={() => void saveSettings({ rotation: v })} />
                <span><b style={{ fontSize: 13 }}>{t(l)}</b><br /><span className="hint">{t(h)}</span></span>
              </label>
            ))}
          </fieldset>
          {([['keys.cooldown', 'cooldownSec', 'keys.sec'], ['keys.concurrency', 'concurrency', ''], ['keys.retries', 'maxRetries', 'keys.times']] as const).map(([l, f, u]) => (
            <label key={f} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text2)' }}>{t(l)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="input mono" type="number" min={f === 'cooldownSec' ? 5 : 1} max={f === 'concurrency' ? 20 : 999} style={{ width: 72, minHeight: 40, textAlign: 'center', padding: '0 8px' }}
                  value={settings[f]} onChange={(e) => void saveSettings({ [f]: Math.max(1, Number(e.target.value) || 1) } as Partial<Settings>)} />
                <span className="hint" style={{ width: 36 }}>{u ? t(u) : ''}</span>
              </span>
            </label>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{t('keys.autoDisable')}</span>
            <Toggle on={settings.autoDisable} label={t('keys.autoDisable')} onChange={(v) => void saveSettings({ autoDisable: v })} />
          </div>
        </section>
        <section className="card" style={{ padding: 18, display: 'flex', gap: 12 }}>
          <span style={{ color: 'var(--text3)', flex: 'none', marginTop: 2 }}><Icon name="lock" size={20} /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{t('keys.privacy')}</span>
            <span className="hint">{t('keys.terms')}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={exportKeys} disabled={!keys.length}>{t('keys.export')}</button>
              <button className="btn sm" onClick={() => fileRef.current?.click()}>{t('keys.import')}</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importKeys(f); e.target.value = ''; }} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
