// MsmDashboard.jsx — MSM Analysis: daily mainstream-media monitor for ODA Abu Dhabi.
// White minimal newsroom dashboard. Data: /api/msm/* (Media-API transcription +
// gpt-5.6-sol-medium streamed analysis, disk-persisted, deduped by videoId).
// Progressive: cards render as each video completes (SSE /api/msm/run); filters are
// instant client-side; per-card skeletons; bilingual EN/AR; fully RTL-safe (logical
// CSS properties + dir attribute from i18n).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, RefreshCw, FileText, FileDown, Sparkles, ChevronDown, ChevronUp,
  AlertTriangle, Clock, CalendarDays, Radio, BrainCircuit, X,
} from 'lucide-react';
import { jget } from '../api.js';
import BilingualLoader from '../components/BilingualLoader.jsx';
import { LANG, isRTL } from '../i18n.js';

const T = {
  en: {
    title: 'MSM Analysis', subtitle: 'Daily mainstream-media monitor · Office of Development Affairs',
    back: 'Suite', refresh: 'Refresh now', running: 'Run in progress…', lastRun: 'Last run',
    never: 'not yet run', date: 'Date', outlets: 'Outlets', all: 'All',
    sentiment: 'Sentiment', positive: 'Positive', neutral: 'Neutral', negative: 'Negative',
    impact: 'Narrative impact', digest: 'Daily digest', balance: 'Sentiment balance',
    flagged: 'Flagged', analysed: 'analysed', transcript: 'Transcript', close: 'Close',
    downloadTxt: 'TXT', downloadDocx: 'DOCX', deeper: 'Analyse deeper',
    thinking: 'Model thinking', summary: 'Executive summary', entities: 'Entities',
    topics: 'Topics', confidence: 'confidence', noVideos: 'No videos recorded for this date.',
    txFailed: 'Transcription failed', anFailed: 'Analysis failed', pending: 'Queued',
    transcribing: 'Transcribing…', analysing: 'Analysing…', notRelevant: 'No direct ODA-theme content',
    schedule: 'Scheduled daily at 06:00 Gulf time (Asia/Dubai)', duration: 'Duration',
    published: 'Published', empty: 'Nothing matches the current filters.',
  },
  ar: {
    title: 'تحليل الإعلام', subtitle: 'مرصد الإعلام الدولي اليومي · مكتب شؤون التنمية',
    back: 'المنصة', refresh: 'تحديث الآن', running: 'التشغيل جارٍ…', lastRun: 'آخر تشغيل',
    never: 'لم يُشغَّل بعد', date: 'التاريخ', outlets: 'الوسائل', all: 'الكل',
    sentiment: 'الاتجاه', positive: 'إيجابي', neutral: 'محايد', negative: 'سلبي',
    impact: 'أثر السردية', digest: 'الموجز اليومي', balance: 'ميزان الاتجاه',
    flagged: 'مُعلَّم', analysed: 'مُحلَّل', transcript: 'النص الكامل', close: 'إغلاق',
    downloadTxt: 'TXT', downloadDocx: 'DOCX', deeper: 'تحليل أعمق',
    thinking: 'تفكير النموذج', summary: 'الملخص التنفيذي', entities: 'الكيانات',
    topics: 'الموضوعات', confidence: 'الثقة', noVideos: 'لا مقاطع مسجلة لهذا التاريخ.',
    txFailed: 'فشل التفريغ', anFailed: 'فشل التحليل', pending: 'في الانتظار',
    transcribing: 'جارٍ التفريغ…', analysing: 'جارٍ التحليل…', notRelevant: 'لا محتوى مباشراً على محاور المكتب',
    schedule: 'مجدول يومياً في ٠٦:٠٠ بتوقيت الخليج (آسيا/دبي)', duration: 'المدة',
    published: 'نُشر', empty: 'لا نتائج مطابقة للمرشحات الحالية.',
  },
};
const t = (k) => (T[LANG] && T[LANG][k]) || T.en[k] || k;

const SENT_META = {
  positive: { cls: 'msm-pill--pos' },
  neutral: { cls: 'msm-pill--neu' },
  negative: { cls: 'msm-pill--neg' },
};
const FLAG_ORDER = ['None', 'Watch', 'Notable', 'High'];
const FLAG_LABEL = {
  en: { None: 'None', Watch: 'Watch', Notable: 'Notable', High: 'High' },
  ar: { None: 'لا شيء', Watch: 'مراقبة', Notable: 'ملحوظ', High: 'مرتفع' },
};
const flagLabel = (f) => (FLAG_LABEL[LANG] || FLAG_LABEL.en)[f] || f;

function fmtDuration(sec) {
  if (!sec && sec !== 0) return null;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(LANG === 'ar' ? 'ar-AE' : 'en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
    });
  } catch { return iso; }
}

/* ---------- transcript slide-open reader ---------- */
function TranscriptReader({ video, onClose }) {
  const [state, setState] = useState({ loading: true, text: null, error: null });
  useEffect(() => {
    let dead = false;
    jget(`/api/msm/transcript/${video.videoId}`)
      .then(j => { if (!dead) setState({ loading: false, text: j.text, error: null }); })
      .catch(e => { if (!dead) setState({ loading: false, text: null, error: e.message }); });
    return () => { dead = true; };
  }, [video.videoId]);
  return (
    <div className="msm-tx" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="msm-tx__bar">
        <span className="msm-tx__label"><FileText size={13} aria-hidden /> {t('transcript')}</span>
        <span className="msm-tx__actions">
          <a className="msm-tx__dl" href={`/api/msm/transcript/${video.videoId}/download?format=txt`} download>
            <FileDown size={12} aria-hidden /> {t('downloadTxt')}
          </a>
          <a className="msm-tx__dl" href={`/api/msm/transcript/${video.videoId}/download?format=docx`} download>
            <FileDown size={12} aria-hidden /> {t('downloadDocx')}
          </a>
          <button className="msm-tx__close" onClick={onClose} aria-label={t('close')}><X size={13} aria-hidden /></button>
        </span>
      </div>
      <div className="msm-tx__body" dir="auto">
        {state.loading && <BilingualLoader size="sm" label={t('transcribing')} />}
        {state.error && <div className="msm-err"><AlertTriangle size={13} aria-hidden /> {state.error}</div>}
        {state.text && <p>{state.text}</p>}
      </div>
    </div>
  );
}

/* ---------- one video card ---------- */
function VideoCard({ video, outlet, onDeeper }) {
  const [txOpen, setTxOpen] = useState(false);
  const [thinkOpen, setThinkOpen] = useState(false);
  const a = video.analysis;
  const busy = video.status === 'transcribing' || video.status === 'analysing' || video.status === 'pending';
  const failed = video.status === 'transcription-failed' || video.status === 'analysis-failed';

  return (
    <article className={`msm-card${failed ? ' msm-card--failed' : ''}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="msm-card__video">
        <iframe
          src={`https://www.youtube.com/embed/${video.videoId}`}
          title={video.title || video.videoId}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <div className="msm-card__head">
        <span className="msm-badge" style={{ background: outlet.color, color: outlet.text }}>
          {LANG === 'ar' ? outlet.ar : outlet.en}{video.subLabel ? ` · ${video.subLabel}` : ''}
        </span>
        <span className="msm-card__meta">
          {video.durationSec != null && <span title={t('duration')}><Clock size={11} aria-hidden /> {fmtDuration(video.durationSec)}</span>}
          {video.publishedAt && <span title={t('published')}><CalendarDays size={11} aria-hidden /> {fmtTime(video.publishedAt)}</span>}
        </span>
      </div>
      <h3 className="msm-card__title" dir="auto">{video.title || `YouTube · ${video.videoId}`}</h3>

      {busy && (
        <div className="msm-card__skel">
          <BilingualLoader size="sm" label={video.status === 'analysing' ? t('analysing') : video.status === 'transcribing' ? t('transcribing') : t('pending')} />
          <div className="msm-skel-line" /><div className="msm-skel-line" /><div className="msm-skel-line short" />
        </div>
      )}

      {failed && (
        <div className="msm-card__fail">
          <AlertTriangle size={14} aria-hidden />
          <div>
            <strong>{video.status === 'transcription-failed' ? t('txFailed') : t('anFailed')}</strong>
            {video.failReason && <div className="msm-card__failwhy">{video.failReason}</div>}
          </div>
        </div>
      )}

      {a && (
        <div className="msm-card__analysis">
          <div className="msm-card__pills">
            <span className={`msm-pill ${SENT_META[a.sentiment.label]?.cls || 'msm-pill--neu'}`}>
              {t(a.sentiment.label)} · {Math.round(a.sentiment.confidence * 100)}% {t('confidence')}
            </span>
            <span className={`msm-flag msm-flag--${a.odaImpact.flag.toLowerCase()}`}>{flagLabel(a.odaImpact.flag)}</span>
            {!a.odaRelevant && <span className="msm-nr">{t('notRelevant')}</span>}
          </div>
          <p className="msm-card__summary" dir="auto">{a.summary}</p>
          {a.odaImpact.reasoning && <p className="msm-card__why" dir="auto">{a.odaImpact.reasoning}</p>}
          {(a.entities?.length > 0 || a.topics?.length > 0) && (
            <div className="msm-card__tags">
              {(a.entities || []).map(e => <span key={`e-${e}`} className="msm-tag msm-tag--entity">{e}</span>)}
              {(a.topics || []).map(x => <span key={`t-${x}`} className="msm-tag">{x}</span>)}
            </div>
          )}
          {a.thinking && (
            <div className="msm-think">
              <button className="msm-think__toggle" onClick={() => setThinkOpen(o => !o)} aria-expanded={thinkOpen}>
                <BrainCircuit size={12} aria-hidden /> {t('thinking')} {thinkOpen ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
              </button>
              {thinkOpen && <pre className="msm-think__body" dir="auto">{a.thinking}</pre>}
            </div>
          )}
          <div className="msm-card__actions">
            <button className="msm-act" onClick={() => setTxOpen(o => !o)} aria-expanded={txOpen}>
              <FileText size={13} aria-hidden /> {t('transcript')}
            </button>
            <button className="msm-act msm-act--primary" onClick={() => onDeeper(video)}>
              <Sparkles size={13} aria-hidden /> {t('deeper')}
            </button>
          </div>
        </div>
      )}

      {!a && !busy && !failed && video.status === 'done' && (
        <div className="msm-card__fail"><AlertTriangle size={14} aria-hidden /> {t('anFailed')}</div>
      )}

      {txOpen && <TranscriptReader video={video} onClose={() => setTxOpen(false)} />}
    </article>
  );
}

/* ---------- digest strip ---------- */
function DigestStrip({ day, liveNarrative, videosById }) {
  const d = day?.digest;
  const bal = d?.sentimentBalance;
  const flags = d?.flagCounts;
  const showLive = !d && liveNarrative;
  if (!d && !showLive) return null;
  return (
    <section className="msm-digest" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="msm-digest__head"><Radio size={13} aria-hidden /> {t('digest')}{d?.builtAt ? ` · ${fmtTime(d.builtAt)}` : ''}</div>
      {showLive && <p className="msm-digest__narrative msm-digest__narrative--live" dir="auto">{liveNarrative}<span className="msm-cursor" /></p>}
      {d && (
        <>
          {d.narrative && <p className="msm-digest__narrative" dir="auto">{d.narrative}</p>}
          {d.top3?.length > 0 && (
            <ol className="msm-digest__top3">
              {d.top3.map((s, i) => {
                const v = videosById[s.videoId];
                return (
                  <li key={s.videoId}>
                    <span className="msm-digest__rank">{i + 1}</span>
                    <div>
                      <strong dir="auto">{s.headline}</strong>
                      <span className="msm-digest__why" dir="auto"> — {s.why}</span>
                      {v && <span className="msm-digest__src"> ({(LANG === 'ar' ? OUTLET_BY_KEY[v.outlet]?.ar : OUTLET_BY_KEY[v.outlet]?.en) || v.outlet})</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="msm-digest__stats">
            {bal && (
              <span className="msm-digest__bal">
                {t('balance')}:
                <i className="msm-dot msm-dot--pos" /> {bal.positive}
                <i className="msm-dot msm-dot--neu" /> {bal.neutral}
                <i className="msm-dot msm-dot--neg" /> {bal.negative}
              </span>
            )}
            {flags && (flags.Notable > 0 || flags.High > 0) && (
              <span className="msm-digest__flags">
                {t('flagged')}: {flags.High > 0 && <em className="msm-flag msm-flag--high">{flagLabel('High')} ×{flags.High}</em>}
                {flags.Notable > 0 && <em className="msm-flag msm-flag--notable">{flagLabel('Notable')} ×{flags.Notable}</em>}
              </span>
            )}
            {d.analysedCount != null && <span>{d.analysedCount} {t('analysed')}</span>}
          </div>
        </>
      )}
    </section>
  );
}

let OUTLET_BY_KEY = {};

/* ---------- main dashboard ---------- */
export default function MsmDashboard({ onExit, onAnalyseDeeper }) {
  const [config, setConfig] = useState(null);
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState(null);      // resolved once config/dates load
  const [day, setDay] = useState(null);
  const [running, setRunning] = useState(false);
  const [liveNarrative, setLiveNarrative] = useState('');
  const [err, setErr] = useState(null);
  const [outletSel, setOutletSel] = useState(new Set()); // empty = all
  const [sentSel, setSentSel] = useState('all');
  const [flagSel, setFlagSel] = useState('all');
  const abortRef = useRef(null);

  const outlets = config?.outlets || [];
  OUTLET_BY_KEY = useMemo(() => Object.fromEntries(outlets.map(o => [o.key, o])), [outlets]);

  const load = useCallback(async (d) => {
    try {
      const j = await jget(`/api/msm/day/${d}`);
      setDay(j.day); setRunning(Boolean(j.running)); setErr(null);
    } catch (e) {
      setDay(null); setErr(e.message);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, dts] = await Promise.all([jget('/api/msm/config'), jget('/api/msm/dates')]);
        setConfig(cfg);
        const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
        const list = dts.dates.includes(today) ? dts.dates : [today, ...dts.dates];
        setDates(list);
        const initial = list.includes(today) ? today : (list[0] || today);
        setDate(initial);
        await load(initial);
      } catch (e) { setErr(e.message); }
    })();
    return () => abortRef.current?.abort();
  }, [load]);

  // poll while a run is active elsewhere (e.g. scheduler-fired)
  useEffect(() => {
    if (!running || !date) return undefined;
    const iv = setInterval(() => load(date), 5000);
    return () => clearInterval(iv);
  }, [running, date, load]);

  const refresh = async () => {
    if (running || !date) return;
    setRunning(true); setLiveNarrative(''); setErr(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch('/api/msm/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }), signal: ac.signal,
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const handle = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        let evt; try { evt = JSON.parse(payload); } catch { return; }
        if (evt.type === 'video' && evt.video) {
          setDay(prev => {
            if (!prev) return prev;
            const videos = prev.videos.some(v => v.videoId === evt.video.videoId)
              ? prev.videos.map(v => v.videoId === evt.video.videoId ? { ...v, ...evt.video } : v)
              : [...prev.videos, evt.video];
            return { ...prev, videos };
          });
        } else if (evt.type === 'digest_delta') {
          setLiveNarrative(n => n + evt.delta);
        } else if (evt.type === 'digest') {
          setDay(prev => prev ? { ...prev, digest: evt.digest } : prev);
          setLiveNarrative('');
        } else if (evt.type === 'day') {
          setDay(evt.day);
        } else if (evt.type === 'error') {
          setErr(evt.message);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setErr(e.message);
    } finally {
      setRunning(false); setLiveNarrative('');
      load(date);
      try { const dts = await jget('/api/msm/dates'); setDates(p => Array.from(new Set([...(p || []), ...dts.dates])).sort().reverse()); } catch { /* non-fatal */ }
    }
  };

  const pickDate = async (d) => { setDate(d); setDay(null); await load(d); };

  const toggleOutlet = (key) => setOutletSel(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const videos = day?.videos || [];
  const videosById = useMemo(() => Object.fromEntries(videos.map(v => [v.videoId, v])), [videos]);
  const filtered = videos.filter(v => {
    if (outletSel.size && !outletSel.has(v.outlet)) return false;
    if (sentSel !== 'all' && v.analysis?.sentiment?.label !== sentSel) return false;
    if (flagSel !== 'all' && v.analysis?.odaImpact?.flag !== flagSel) return false;
    return true;
  });

  return (
    <div className="msm" dir={isRTL ? 'rtl' : 'ltr'}>
      <header className="msm-head">
        <div className="msm-head__row">
          <button className="ig-exit" onClick={onExit}><ArrowLeft size={13} aria-hidden style={{ verticalAlign: '-2px', transform: isRTL ? 'scaleX(-1)' : 'none' }} /> {t('back')}</button>
          <div className="msm-head__titles">
            <h1>{t('title')}</h1>
            <p>{t('subtitle')}</p>
          </div>
          <div className="msm-head__run">
            <button className="msm-refresh" onClick={refresh} disabled={running || !date}>
              <RefreshCw size={13} aria-hidden className={running ? 'msm-spin' : ''} /> {running ? t('running') : t('refresh')}
            </button>
            <span className="msm-lastrun">
              {t('lastRun')}: {day?.lastRunAt ? fmtTime(day.lastRunAt) : t('never')}
            </span>
            <span className="msm-sched" title={config?.schedule?.cron || ''}>{t('schedule')}</span>
          </div>
        </div>
        <div className="msm-filters">
          <label className="msm-datepick">
            <CalendarDays size={13} aria-hidden />
            <select value={date || ''} onChange={e => pickDate(e.target.value)} aria-label={t('date')}>
              {(dates.length ? dates : date ? [date] : []).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <div className="msm-chiprow" role="group" aria-label={t('outlets')}>
            <button className={`msm-chip${outletSel.size === 0 ? ' on' : ''}`} onClick={() => setOutletSel(new Set())}>{t('all')}</button>
            {outlets.map(o => (
              <button key={o.key} className={`msm-chip${outletSel.has(o.key) ? ' on' : ''}`} onClick={() => toggleOutlet(o.key)}>
                <i className="msm-chip__dot" style={{ background: o.color === '#FFF1E5' ? '#990F3D' : o.color }} />
                {LANG === 'ar' ? o.ar : o.en}
              </button>
            ))}
          </div>
          <div className="msm-chiprow msm-chiprow--tight" role="group" aria-label={t('sentiment')}>
            {['all', 'positive', 'neutral', 'negative'].map(s => (
              <button key={s} className={`msm-chip${sentSel === s ? ' on' : ''}`} onClick={() => setSentSel(s)}>
                {s === 'all' ? t('all') : t(s)}
              </button>
            ))}
          </div>
          <div className="msm-chiprow msm-chiprow--tight" role="group" aria-label={t('impact')}>
            <button className={`msm-chip${flagSel === 'all' ? ' on' : ''}`} onClick={() => setFlagSel('all')}>{t('all')}</button>
            {FLAG_ORDER.map(f => (
              <button key={f} className={`msm-chip${flagSel === f ? ' on' : ''}`} onClick={() => setFlagSel(f)}>{flagLabel(f)}</button>
            ))}
          </div>
        </div>
      </header>

      {err && <div className="msm-err msm-err--page"><AlertTriangle size={14} aria-hidden /> {err}</div>}

      <DigestStrip day={day} liveNarrative={liveNarrative} videosById={videosById} />

      {!day && !err && <div className="msm-loadwrap"><BilingualLoader size="md" label={t('running')} /></div>}

      {day && videos.length === 0 && <div className="msm-empty">{t('noVideos')}</div>}
      {day && videos.length > 0 && filtered.length === 0 && <div className="msm-empty">{t('empty')}</div>}

      <div className="msm-grid">
        {filtered.map(v => (
          <VideoCard key={v.videoId} video={v} outlet={OUTLET_BY_KEY[v.outlet] || { en: v.outlet, ar: v.outlet, color: '#678CA5', text: '#fff' }} onDeeper={onAnalyseDeeper} />
        ))}
      </div>
    </div>
  );
}
