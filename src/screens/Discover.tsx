// Trang Khám phá: hiện bảng xếp hạng lấy sẵn mỗi ngày (public/discover/data.json do GitHub Actions tạo).
// Dịch tên & tóm tắt bằng key Gemini của chính người dùng, lưu bản dịch vào IndexedDB.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../lib/db';
import { translateBatch } from '../lib/actions';
import { base, isCjk, langName, promptLangName } from '../lib/langs';
import type { ChunkItem } from '../lib/types';
import { useKeys } from '../hooks';
import { useT, type MsgKey } from '../i18n';
import { Page, Title, Toggle, useToast } from '../ui/common';
import { Icon } from '../ui/icons';
import { href } from '../router';

interface DItem { rank: number; title: string; titleEn?: string; author?: string; url: string; cover?: string; blurb?: string; blurbEn?: string; tags?: string[]; year?: number }
interface DList { id: string; url?: string; board?: string; boardZh?: string; items: DItem[] }
interface DSource { id: string; homepage: string; via?: { name: string; url: string }; stability: 'stable' | 'experimental'; lang: string; ok: boolean; error?: string; updatedAt: string | null; lists: DList[] }
interface DData { generatedAt: string; sources: DSource[] }

const SOURCE_NAMES: Record<string, { vi: string; en: string }> = {
  'ds-qidian': { vi: 'Khởi Điểm (Qidian)', en: 'Qidian' },
  'ds-jjwxc': { vi: 'Tấn Giang (JJWXC)', en: 'JJWXC' },
  'ds-fanqie': { vi: 'Fanqie', en: 'Fanqie' },
  'ds-faloo': { vi: 'Faloo', en: 'Faloo' },
  'ds-qimao': { vi: 'Qimao', en: 'Qimao' },
  'ds-zongheng': { vi: 'Tung Hoành (Zongheng)', en: 'Zongheng' },
  'ds-seventeenk': { vi: '17K', en: '17K' },
  'ds-sfacg': { vi: 'SFACG', en: 'SFACG' },
  'ds-ciweimao': { vi: 'Ciweimao', en: 'Ciweimao' },
  openlibrary: { vi: 'Open Library', en: 'Open Library' },
};
const srcName = (id: string, lang: 'vi' | 'en') => SOURCE_NAMES[id]?.[lang] ?? id;
const LIST_ORDER = ['hot', 'new', 'completed'];

function fmtTime(iso: string | null, lang: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' }) + (lang === 'vi' ? ' hôm nay' : ' today')
    : d.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

const ck = (tgt: string, url: string, f: 't' | 'b') => `dc|${tgt}|${f}|${url}`;
const TR_KEY = 'wt.dc.translate';

export default function Discover() {
  const { t, lang } = useT();
  const toast = useToast();
  const { keys } = useKeys();
  const [data, setData] = useState<DData | null | undefined>(undefined);
  const [source, setSource] = useState<string>('all');
  const [list, setList] = useState<string>('hot');
  const [translate, setTranslate] = useState<boolean>(() => { try { return localStorage.getItem(TR_KEY) !== '0'; } catch { return true; } });
  const [tr, setTr] = useState<Record<string, string>>({});
  const [showOrig, setShowOrig] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const failed = useRef(new Set<string>());

  useEffect(() => {
    fetch('./discover/data.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && Array.isArray(d.sources) ? d : null))
      .catch(() => setData(null));
  }, []);

  const usableKeys = keys.filter((k) => !k.disabled && k.state !== 'invalid');
  const tgt = lang;
  const tgtLabel = lang === 'vi' ? promptLangName(tgt) : langName(tgt, 'en');
  const lists = useMemo(() => {
    const ids = new Set<string>();
    data?.sources.forEach((s) => s.lists.forEach((l) => ids.add(l.id)));
    return LIST_ORDER.filter((x) => ids.has(x)).concat([...ids].filter((x) => !LIST_ORDER.includes(x)));
  }, [data]);

  // Các khối đang hiển thị: [nguồn, danh sách]
  const visible = useMemo(() => {
    if (!data) return [] as { s: DSource; l: DList | undefined }[];
    return data.sources
      .filter((s) => source === 'all' || s.id === source)
      .map((s) => ({ s, l: s.lists.find((x) => x.id === list) ?? (source !== 'all' ? s.lists[0] : undefined) }))
      .filter((x) => source !== 'all' || x.l || !x.s.lists.length);
  }, [data, source, list]);

  // Đọc bản dịch đã lưu cho các mục đang hiện
  useEffect(() => {
    const keysToRead: string[] = [];
    for (const { s, l } of visible) {
      if (!l || base(s.lang) === base(tgt)) continue;
      for (const it of l.items) { keysToRead.push(ck(tgt, it.url, 't')); if (it.blurb) keysToRead.push(ck(tgt, it.url, 'b')); }
    }
    if (!keysToRead.length) return;
    void db.getCacheMany(keysToRead).then((got) => setTr((old) => ({ ...old, ...got })));
  }, [visible, tgt]);

  // Dịch những mục chưa có bản dịch (theo lô, mỗi lô một request)
  useEffect(() => {
    if (!translate || !usableKeys.length || running.current) return;
    const todo: { s: DSource; items: DItem[] }[] = [];
    for (const { s, l } of visible) {
      if (!l || base(s.lang) === base(tgt)) continue;
      const missing = l.items.filter((it) => !(tgt === 'en' && it.titleEn) && !(ck(tgt, it.url, 't') in tr) && !failed.current.has(`${tgt}|${it.url}`));
      if (missing.length) todo.push({ s, items: missing });
    }
    if (!todo.length) return;
    running.current = true;
    setBusy(true);
    (async () => {
      try {
        for (const { s, items } of todo) {
          for (let i = 0; i < items.length; i += 15) {
            const part = items.slice(i, i + 15);
            const req: ChunkItem[] = [];
            part.forEach((it, j) => {
              req.push({ id: `${j}t`, text: it.title });
              if (it.blurb) req.push({ id: `${j}b`, text: it.blurb });
            });
            try {
              const res = await translateBatch(req, s.lang, tgt);
              const save: Record<string, string> = {};
              part.forEach((it, j) => {
                if (res[`${j}t`]) save[ck(tgt, it.url, 't')] = res[`${j}t`];
                if (it.blurb && res[`${j}b`]) save[ck(tgt, it.url, 'b')] = res[`${j}b`];
              });
              await db.putCacheMany(save);
              setTr((old) => ({ ...old, ...save }));
            } catch (e: any) {
              part.forEach((it) => failed.current.add(`${tgt}|${it.url}`));
              toast(t('dc.trFail', { e: e?.message === 'no_keys' ? t('err.no_keys') : String(e?.message || e).slice(0, 160) }), 'err');
              return;
            }
          }
        }
      } finally {
        running.current = false;
        setBusy(false);
      }
    })();
  }, [translate, usableKeys.length, visible, tgt, tr]);

  const setTranslatePref = (v: boolean) => {
    setTranslate(v);
    try { localStorage.setItem(TR_KEY, v ? '1' : '0'); } catch { /* bỏ qua */ }
  };

  const card = (s: DSource, it: DItem) => {
    const needTr = base(s.lang) !== base(tgt);
    // Tiếng Anh: dùng sẵn bản dịch của DaoSearch nếu có, khỏi tốn request Gemini
    const fromSource = tgt === 'en' && !!it.titleEn;
    const trTitle = !needTr ? undefined : fromSource ? it.titleEn : tr[ck(tgt, it.url, 't')];
    const trBlurb = !needTr ? undefined : fromSource ? (it.blurbEn ?? tr[ck(tgt, it.url, 'b')]) : it.blurb ? tr[ck(tgt, it.url, 'b')] : undefined;
    const orig = showOrig.has(it.url);
    const cjk = isCjk(s.lang);
    const blurb = !orig && translate && trBlurb ? trBlurb : it.blurb;
    const toggleOrig = () => setShowOrig((o) => { const n = new Set(o); if (n.has(it.url)) n.delete(it.url); else n.add(it.url); return n; });
    return (
      <article key={it.url} className="card dcard">
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ position: 'relative', flex: 'none' }}>
            <span className="rank">#{it.rank}</span>
            <div className="dcover">
              {it.cover
                ? <img src={it.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : <span className={cjk ? 'zh vt' : 'lt'}>{cjk ? it.title.slice(0, 6) : it.title}</span>}
            </div>
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 className={cjk ? 'zh' : ''} style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }} lang={s.lang}>{it.title}</h3>
            {translate && trTitle && !orig && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{trTitle}</span>}
            {(it.author || it.year) && <span className={`hint${cjk ? ' zh' : ''}`}>{[it.author, it.year].filter(Boolean).join(' · ')}</span>}
            {!!it.tags?.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {it.tags.slice(0, 3).map((g) => <span key={g} className="chip mute plain">{g}</span>)}
              </div>
            )}
          </div>
        </div>
        {blurb && <p className="clamp3" style={{ margin: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{blurb}</p>}
        {translate && (trTitle || trBlurb) && (
          <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Icon name="spark" size={14} />{fromSource && s.via ? t('dc.enFromVia', { s: s.via.name }) : t('dc.translatedBy')} · <button className="linkbtn hint" onClick={toggleOrig}>{orig ? t('dc.showTr') : t('dc.showOrig')}</button>
          </span>
        )}
        <a className="btn sm" style={{ marginTop: 'auto' }} href={it.url} target="_blank" rel="noopener noreferrer">
          {t('dc.open', { s: s.via?.name || srcName(s.id, lang) })}<Icon name="external" size={14} />
        </a>
      </article>
    );
  };

  const section = (s: DSource, l: DList | undefined) => (
    <section key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="h2" style={{ fontSize: 20 }}>{srcName(s.id, lang)}{l ? ` · ${t(`dc.list.${l.id}` as MsgKey)}` : ''}</h2>
            <span className={`chip ${s.stability === 'stable' ? 'ok' : 'warn'} plain`}>{t(s.stability === 'stable' ? 'dc.stable' : 'dc.experimental')}</span>
          </div>
          <span className="hint">
            {s.updatedAt ? t('dc.updated', { t: fmtTime(s.updatedAt, lang) }) : t('dc.never')}
            {l?.board ? ` · ${t('dc.board', { b: l.boardZh ? `${l.board} (${l.boardZh})` : l.board })}` : ''}
            {' · '}
            {s.via
              ? <>{t('dc.src.via')} <a href={s.via.url} target="_blank" rel="noopener noreferrer">{s.via.name}</a></>
              : t('dc.src.openlibrary.api')}
          </span>
          {!s.ok && <span className="hint" style={{ color: 'var(--warn)' }} title={s.error}>{s.lists.length ? t('dc.failed') : t('dc.failedEmpty')}</span>}
        </div>
        <a className="btn sm" href={l?.url || s.homepage} target="_blank" rel="noopener noreferrer">{t('dc.openList')}<Icon name="external" size={14} /></a>
      </div>
      {l && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {l.items.map((it) => card(s, it))}
        </div>
      )}
    </section>
  );

  return (
    <Page>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <Title title={t('dc.title')} sub={t('dc.sub')} />
        <a className="btn pri" href={href('/new')}><Icon name="plus" />{t('nav.new')}</a>
      </div>

      {data === undefined && <p className="hint">{t('common.loading')}</p>}
      {data === null && <div className="card" style={{ padding: 32, color: 'var(--text3)' }}>{t('dc.empty')}</div>}

      {data && (
        <>
          <div className="card" style={{ padding: '14px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px' }}>
            <div className="seg" role="group" aria-label="Source">
              <button className={source === 'all' ? 'on' : ''} onClick={() => setSource('all')}>{t('common.all')}</button>
              {data.sources.map((s) => <button key={s.id} className={source === s.id ? 'on' : ''} onClick={() => setSource(s.id)}>{srcName(s.id, lang)}</button>)}
            </div>
            {lists.length > 1 && (
              <div className="seg" role="group" aria-label="List">
                {lists.map((x) => <button key={x} className={list === x ? 'on' : ''} onClick={() => setList(x)}>{t(`dc.list.${x}` as MsgKey)}</button>)}
              </div>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text2)' }} title={t('dc.translateHint')}>
              {busy && <span className="spin" />}
              <Toggle on={translate} label={t('dc.translate', { l: tgtLabel })} onChange={setTranslatePref} />
              {t('dc.translate', { l: tgtLabel })}
            </span>
          </div>
          {translate && !usableKeys.length && (
            <div className="card" role="note" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', color: 'var(--info)', background: 'var(--info-bg)', borderColor: 'transparent' }}>
              <Icon name="key" /><span style={{ color: 'var(--text2)' }}>{t('dc.needKey')}</span>
              <a className="btn sm" style={{ marginLeft: 'auto' }} href={href('/keys')}>{t('nav.keys')}</a>
            </div>
          )}
          {visible.map(({ s, l }) => section(s, l))}
          <div className="card" role="note" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'transparent', borderStyle: 'dashed' }}>
            <Icon name="info" />
            <span className="hint" style={{ fontSize: 13 }}>
              {t('dc.note')}{' '}
              {data.sources.some((s) => s.via) && <>{t('dc.credit')} <a href="https://daosearch.io/" target="_blank" rel="noopener noreferrer">DaoSearch</a> · <a href="https://openlibrary.org/" target="_blank" rel="noopener noreferrer">Open Library</a>.</>}
            </span>
          </div>
        </>
      )}
    </Page>
  );
}
