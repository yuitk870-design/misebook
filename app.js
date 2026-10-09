// MiseBook — shift log, stock check and food cost for kitchens.
// Pixel Pantry. Plain ES modules, no build step.
import { html, render, useState, useEffect, useMemo, useRef } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
  onSnapshot, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDTOEStlG75fcWUKuvBcg6QpQ6NC0X1KUI',
  authDomain: 'misebook-7ccb1.firebaseapp.com',
  projectId: 'misebook-7ccb1',
  storageBucket: 'misebook-7ccb1.firebasestorage.app',
  messagingSenderId: '1021927937738',
  appId: '1:1021927937738:web:b71250e1287133b071c633',
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(fbApp, {});
}

/* ---------------- helpers ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const todayKey = () => dateKey(new Date());
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (k) => { const d = fromKey(k); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };
const fmtDayYear = (k) => { const d = fromKey(k); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`; };
const fmtTime = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const sameDay = dateKey(d) === todayKey();
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameDay ? t : `${MON[d.getMonth()]} ${d.getDate()} ${t}`;
};
const money = (n) => (isFinite(n) ? `$${n.toFixed(2)}` : '—');
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmtNum = (n) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const uid8 = () => Math.random().toString(36).slice(2, 10);
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function useToast() {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  const show = (m) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 2200); };
  return [msg, show];
}

function useCollection(name, kitchenCode) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!kitchenCode) return;
    const q = query(collection(db, name), where('kitchenCode', '==', kitchenCode));
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.error(name, e); setRows([]); });
  }, [name, kitchenCode]);
  return rows;
}

/* ---------------- weather (Open-Meteo, no key) ---------------- */
const WEATHER = [
  { key: 'clear', label: 'Clear' },
  { key: 'cloudy', label: 'Cloudy' },
  { key: 'rain', label: 'Rain' },
  { key: 'snow', label: 'Snow' },
  { key: 'fog', label: 'Fog' },
  { key: 'storm', label: 'Storm' },
];
const wLabel = (k) => (WEATHER.find((w) => w.key === k) || {}).label || '—';
function wmoToKey(c) {
  if (c == null) return null;
  if (c === 0 || c === 1) return 'clear';
  if (c === 2 || c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'storm';
  return 'cloudy';
}
async function fetchWeather(lat, lon, key) {
  const daysAgo = Math.round((fromKey(todayKey()) - fromKey(key)) / 864e5);
  const base = daysAgo > 80 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max&timezone=auto&start_date=${key}&end_date=${key}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('weather');
  const j = await r.json();
  const code = j.daily?.weather_code?.[0];
  const t = j.daily?.temperature_2m_max?.[0];
  return { weather: wmoToKey(code), tempC: t == null ? null : Math.round(t) };
}

/* ---------------- icons ---------------- */
const Icon = {
  log: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h11M4 10h11M4 15h7"/><path d="M14.5 19.5l5.8-5.8a1.6 1.6 0 0 0-2.3-2.3l-5.8 5.8-.7 3z"/></svg>`,
  stock: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 12.5l2.2 2.2 4.8-4.8"/></svg>`,
  cost: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01M8.5 18.5h7"/></svg>`,
  gear: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  close: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  left: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  right: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
};

/* ================= JOIN ================= */
function JoinScreen({ user, onJoined }) {
  const [name, setName] = useState(localStorage.getItem('mb_name') || '');
  const [code, setCode] = useState('');
  const [kitchenName, setKitchenName] = useState('');
  const [mode, setMode] = useState('join');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function join() {
    setErr('');
    const c = code.trim().toUpperCase().replace(/\s+/g, '');
    if (!name.trim()) return setErr('Enter your name.');
    if (!c) return setErr('Enter the kitchen code.');
    setBusy(true);
    try {
      const k = await getDoc(doc(db, 'kitchens', c));
      if (!k.exists()) { setErr('No kitchen with that code. Check the spelling.'); setBusy(false); return; }
      await setDoc(doc(db, 'members', user.uid), { kitchenCode: c, name: name.trim(), joinedAt: serverTimestamp() });
      localStorage.setItem('mb_name', name.trim());
      onJoined();
    } catch (e) { console.error(e); setErr('Could not join. Check your internet and try again.'); setBusy(false); }
  }

  async function create() {
    setErr('');
    if (!name.trim()) return setErr('Enter your name.');
    if (!kitchenName.trim()) return setErr('Enter a kitchen name.');
    setBusy(true);
    try {
      const prefix = (kitchenName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'KTCH');
      let c = '';
      for (let i = 0; i < 6; i++) {
        let r = ''; for (let j = 0; j < 5; j++) r += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        c = `${prefix}-${r}`;
        const ex = await getDoc(doc(db, 'kitchens', c));
        if (!ex.exists()) break;
      }
      await setDoc(doc(db, 'kitchens', c), {
        name: kitchenName.trim(), createdAt: serverTimestamp(), createdBy: user.uid,
        lat: 49.2827, lon: -123.1207, place: 'Vancouver, BC', targetPct: 30, round: null,
      });
      await setDoc(doc(db, 'members', user.uid), { kitchenCode: c, name: name.trim(), joinedAt: serverTimestamp() });
      await addDoc(collection(db, 'metrics'), { kitchenCode: c, name: 'Guests', order: 1, active: true });
      await addDoc(collection(db, 'metrics'), { kitchenCode: c, name: 'Tickets', order: 2, active: true });
      localStorage.setItem('mb_name', name.trim());
      onJoined(c);
    } catch (e) { console.error(e); setErr('Could not create the kitchen. Check your internet and try again.'); setBusy(false); }
  }

  return html`
  <div class="join">
    <div>
      <div class="join-mark">Mise<span>Book</span></div>
      <div class="join-tag">Shift log, stock check and food cost — shared with your kitchen.</div>
    </div>
    <div class="card stack">
      <div>
        <label for="nm">Your name</label>
        <input id="nm" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Sangjin" autocomplete="given-name" />
        <div class="small muted" style="margin-top:6px">Shown when you check stock, so the team knows who did it.</div>
      </div>
      <div class="seg">
        <button class=${mode === 'join' ? 'on' : ''} onClick=${() => setMode('join')}>Join a kitchen</button>
        <button class=${mode === 'create' ? 'on' : ''} onClick=${() => setMode('create')}>New kitchen</button>
      </div>
      ${mode === 'join' ? html`
        <div>
          <label for="cd">Kitchen code</label>
          <input id="cd" value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} placeholder="SURA-7K3PQ" autocapitalize="characters" autocomplete="off" style="font-family:var(--mono);letter-spacing:.06em" />
        </div>
        <button class="btn primary block" disabled=${busy} onClick=${join}>${busy ? 'Joining…' : 'Join kitchen'}</button>
      ` : html`
        <div>
          <label for="kn">Kitchen name</label>
          <input id="kn" value=${kitchenName} onInput=${(e) => setKitchenName(e.target.value)} placeholder="e.g. Sura" />
        </div>
        <button class="btn primary block" disabled=${busy} onClick=${create}>${busy ? 'Creating…' : 'Create kitchen'}</button>
        <div class="small muted">You'll get a code to share with your team.</div>
      `}
      ${err && html`<div class="err">${err}</div>`}
    </div>
    <div class="small muted" style="text-align:center">by Pixel Pantry</div>
  </div>`;
}

/* ================= LOG ================= */
function LogView({ kitchen, code, me, metrics, toast }) {
  const [day, setDay] = useState(todayKey());
  const [log, setLog] = useState(undefined);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [weatherState, setWeatherState] = useState('');
  const [cmp, setCmp] = useState({});
  const [recent, setRecent] = useState([]);
  const [chartMetric, setChartMetric] = useState('busy');
  const dirty = useRef(false);

  const active = useMemo(() => (metrics || []).filter((m) => m.active !== false).sort(byOrder), [metrics]);
  const logId = (k) => `${code}_${k}`;

  // live doc for selected day
  useEffect(() => {
    setLog(undefined); setForm(null); dirty.current = false;
    return onSnapshot(doc(db, 'daily_logs', logId(day)), (s) => setLog(s.exists() ? s.data() : null), (e) => { console.error(e); setLog(null); });
  }, [day, code]);

  // build form from doc (unless user is editing)
  useEffect(() => {
    if (log === undefined || dirty.current) return;
    const vals = {};
    (log?.values || []).forEach((v) => { vals[v.metricId] = v.value == null ? '' : String(v.value); });
    setForm({ busy: log?.busyLevel ?? null, values: vals, weather: log?.weather ?? null, tempC: log?.tempC ?? null, memo: log?.memo ?? '' });
    if (!log && kitchen?.lat != null && day <= todayKey()) {
      setWeatherState('loading');
      fetchWeather(kitchen.lat, kitchen.lon, day)
        .then((w) => { setForm((f) => (f && !f.weather ? { ...f, weather: w.weather, tempC: w.tempC } : f)); setWeatherState('auto'); })
        .catch(() => setWeatherState('fail'));
    } else setWeatherState(log?.weather ? 'saved' : '');
  }, [log]);

  // comparisons
  useEffect(() => {
    let live = true;
    const keys = { week: addDays(day, -7), year: addDays(day, -364) };
    Promise.all(Object.entries(keys).map(async ([k, d]) => {
      try { const s = await getDoc(doc(db, 'daily_logs', logId(d))); return [k, { key: d, data: s.exists() ? s.data() : null }]; }
      catch (e) { return [k, { key: d, data: null }]; }
    })).then((r) => live && setCmp(Object.fromEntries(r)));
    return () => { live = false; };
  }, [day, code, log]);

  // last 14 days
  useEffect(() => {
    let live = true;
    const keys = Array.from({ length: 14 }, (_, i) => addDays(todayKey(), -13 + i));
    Promise.all(keys.map(async (k) => {
      try { const s = await getDoc(doc(db, 'daily_logs', logId(k))); return { key: k, data: s.exists() ? s.data() : null }; }
      catch (e) { return { key: k, data: null }; }
    })).then((r) => live && setRecent(r));
    return () => { live = false; };
  }, [code, log]);

  const upd = (patch) => { dirty.current = true; setForm((f) => ({ ...f, ...patch })); };

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const values = active.map((m) => ({ metricId: m.id, name: m.name, value: num(form.values[m.id]) }));
      // keep values of hidden/deleted metrics that were saved before
      (log?.values || []).forEach((v) => { if (!values.find((x) => x.metricId === v.metricId)) values.push(v); });
      await setDoc(doc(db, 'daily_logs', logId(day)), {
        kitchenCode: code, dateKey: day, date: Timestamp.fromDate(fromKey(day)),
        busyLevel: form.busy, weather: form.weather, tempC: form.tempC == null ? null : num(form.tempC),
        memo: form.memo || '', values, updatedBy: me.name, updatedAt: serverTimestamp(),
      }, { merge: true });
      dirty.current = false;
      toast('Saved');
    } catch (e) { console.error(e); toast('Could not save — check internet'); }
    setSaving(false);
  }

  const valOf = (data, metricId, name) => {
    if (!data) return null;
    const v = (data.values || []).find((x) => x.metricId === metricId) || (data.values || []).find((x) => x.name === name);
    return v ? v.value : null;
  };
  const current = (m) => num(form?.values?.[m.id]);

  function Delta({ now, then }) {
    if (now == null || then == null || then === 0) return null;
    const p = Math.round(((now - then) / then) * 100);
    const cls = p > 0 ? 'up' : p < 0 ? 'down' : 'flat';
    return html`<span class=${'delta ' + cls}>${p > 0 ? '+' : ''}${p}%</span>`;
  }

  function CmpCol({ title, c }) {
    const d = c?.data;
    return html`<div class="cmp-col">
      <h4>${title}</h4>
      <div class="d">${c ? fmtDayYear(c.key) : ''}</div>
      ${!d ? html`<div class="small muted">No log that day.</div>` : html`
        <div class="cmp-line"><span>Busy</span><span class="v">${d.busyLevel ?? '—'}<span class="muted">/5</span><${Delta} now=${form?.busy} then=${d.busyLevel} /></span></div>
        ${active.map((m) => html`<div class="cmp-line"><span>${m.name}</span><span class="v">${fmtNum(valOf(d, m.id, m.name))}<${Delta} now=${current(m)} then=${valOf(d, m.id, m.name)} /></span></div>`)}
        <div class="cmp-line"><span>Weather</span><span>${wLabel(d.weather)}${d.tempC != null ? ` ${d.tempC}°` : ''}</span></div>
        ${d.memo ? html`<div class="small muted" style="margin-top:6px">“${d.memo}”</div>` : ''}
      `}
    </div>`;
  }

  const chartVal = (r) => (chartMetric === 'busy' ? r.data?.busyLevel ?? null : valOf(r.data, chartMetric, (active.find((m) => m.id === chartMetric) || {}).name));
  const maxV = Math.max(1, ...recent.map((r) => chartVal(r) || 0));

  return html`
  <div class="page">
    <div class="datebar">
      <button class="icon-btn" aria-label="Previous day" onClick=${() => setDay(addDays(day, -1))}>${Icon.left}</button>
      <div class="when"><b>${day === todayKey() ? 'Today' : fmtDay(day)}</b><span>${fmtDayYear(day)}</span></div>
      <button class="icon-btn" aria-label="Next day" disabled=${day >= todayKey()} onClick=${() => setDay(addDays(day, 1))}>${Icon.right}</button>
    </div>

    ${!form ? html`<div class="card empty">Loading…</div>` : html`
    <div class="card stack">
      <div>
        <label>How busy was it?</label>
        <div class="busy">
          ${[1, 2, 3, 4, 5].map((n) => html`<button class=${form.busy === n ? 'on' : ''} onClick=${() => upd({ busy: form.busy === n ? null : n })}>
            <b>${n}</b><span>${['Dead', 'Slow', 'Normal', 'Busy', 'Slammed'][n - 1]}</span></button>`)}
        </div>
      </div>

      <div>
        <label>Numbers</label>
        ${active.length === 0 ? html`<div class="small muted">No items yet. Add them in Settings (gear icon).</div>` : ''}
        ${active.map((m) => html`<div class="metric-input">
          <span>${m.name}</span>
          <input inputmode="decimal" placeholder="0" value=${form.values[m.id] ?? ''} onInput=${(e) => upd({ values: { ...form.values, [m.id]: e.target.value } })} />
        </div>`)}
      </div>

      <div>
        <div class="row between"><label style="margin:0">Weather</label>
          <span class="small muted">${weatherState === 'loading' ? 'Getting weather…' : weatherState === 'auto' ? `Auto · ${kitchen.place || ''}` : weatherState === 'fail' ? 'Pick manually' : ''}</span></div>
        <div class="chips" style="margin-top:6px">
          ${WEATHER.map((w) => html`<button class=${'chip' + (form.weather === w.key ? ' on' : '')} onClick=${() => upd({ weather: form.weather === w.key ? null : w.key })}>${w.label}</button>`)}
        </div>
        <div class="row" style="margin-top:8px">
          <span class="small muted">High</span>
          <input style="width:90px" inputmode="decimal" value=${form.tempC ?? ''} onInput=${(e) => upd({ tempC: e.target.value })} placeholder="°C" />
          <span class="small muted">°C</span>
        </div>
      </div>

      <div>
        <label for="memo">Notes</label>
        <textarea id="memo" value=${form.memo} onInput=${(e) => upd({ memo: e.target.value })} placeholder="Big group, event nearby, short staff, 86'd items…"></textarea>
      </div>

      <button class="btn primary block" disabled=${saving} onClick=${save}>${saving ? 'Saving…' : log ? 'Update log' : 'Save log'}</button>
      ${log?.updatedBy ? html`<div class="small muted" style="text-align:center">Last saved by ${log.updatedBy} ${fmtTime(log.updatedAt)}</div>` : ''}
    </div>`}

    <div class="card">
      <h3>Compared to</h3>
      <div class="cmp">
        <${CmpCol} title="Last week" c=${cmp.week} />
        <${CmpCol} title="Last year" c=${cmp.year} />
      </div>
      <div class="small muted" style="margin-top:8px">Same weekday. Last year fills in once you've logged for a year — start today.</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Last 14 days</h3>
        <select style="width:auto;padding:6px 10px;font-size:14px" value=${chartMetric} onChange=${(e) => setChartMetric(e.target.value)}>
          <option value="busy">Busy</option>
          ${active.map((m) => html`<option value=${m.id}>${m.name}</option>`)}
        </select>
      </div>
      <div class="bars">
        ${recent.map((r) => { const v = chartVal(r); return html`<button class=${'b' + (r.key === day ? ' sel' : '')} style="border:0;background:none;padding:0" onClick=${() => setDay(r.key)} title=${r.key}>
          <i style=${`height:${v == null ? 2 : Math.max(4, (v / maxV) * 70)}px;${v == null ? 'opacity:.4' : ''}`}></i><em>${fromKey(r.key).getDate()}</em></button>`; })}
      </div>
    </div>
  </div>`;
}

/* ================= STOCK ================= */
function StockView({ kitchen, code, me, toast }) {
  const items = useCollection('inventory_items', code);
  const [mode, setMode] = useState('check');
  const round = kitchen?.round || null;
  const roundOpen = round && !round.completedAt;
  const list = useMemo(() => (items || []).filter((i) => i.active !== false).sort((a, b) => String(a.section || '').localeCompare(String(b.section || '')) || byOrder(a, b)), [items]);
  const sections = useMemo(() => { const s = []; list.forEach((i) => { const n = i.section || 'Other'; if (!s.includes(n)) s.push(n); }); return s; }, [list]);
  const checked = list.filter((i) => roundOpen && i.checkedRound === round.id);
  const low = list.filter((i) => i.qty != null && i.par != null && i.qty < i.par);

  async function startRound() {
    try {
      await updateDoc(doc(db, 'kitchens', code), { round: { id: uid8(), startedAt: serverTimestamp(), startedBy: me.name, completedAt: null, completedBy: null } });
      toast('New stock check started');
    } catch (e) { console.error(e); toast('Could not start — check internet'); }
  }
  async function completeRound() {
    try {
      await addDoc(collection(db, 'inventory_rounds'), {
        kitchenCode: code, roundId: round.id, startedAt: round.startedAt || null, startedBy: round.startedBy || '',
        completedAt: serverTimestamp(), completedBy: me.name,
        belowPar: low.map((i) => ({ name: i.name, qty: i.qty, par: i.par, unit: i.unit || '' })),
      });
      await updateDoc(doc(db, 'kitchens', code), { 'round.completedAt': serverTimestamp(), 'round.completedBy': me.name });
      toast('Stock check complete');
      if (low.length) setMode('order');
    } catch (e) { console.error(e); toast('Could not complete — check internet'); }
  }
  async function setQty(item, qty) {
    if (qty == null || qty < 0) return;
    const patch = { qty, checkedBy: me.name, checkedAt: serverTimestamp() };
    if (roundOpen) patch.checkedRound = round.id;
    if (item.par != null && qty >= item.par) { patch.ordered = false; patch.orderNote = ''; }
    try { await updateDoc(doc(db, 'inventory_items', item.id), patch); } catch (e) { console.error(e); toast('Could not save — check internet'); }
  }

  return html`
  <div class="page">
    <div class="seg">
      <button class=${mode === 'check' ? 'on' : ''} onClick=${() => setMode('check')}>Check</button>
      <button class=${mode === 'order' ? 'on' : ''} onClick=${() => setMode('order')}>Order list${low.length ? ` (${low.length})` : ''}</button>
      <button class=${mode === 'manage' ? 'on' : ''} onClick=${() => setMode('manage')}>Items</button>
    </div>

    ${items === null ? html`<div class="card empty">Loading…</div>` : mode === 'check' ? html`
      ${list.length === 0 ? html`<div class="card empty">No items yet.<br/><button class="btn sm" style="margin-top:10px" onClick=${() => setMode('manage')}>Add stock items</button></div>` : html`
      <div class="card stack">
        ${roundOpen ? html`
          <div class="row between"><b>Check in progress</b><span class="small muted">by ${round.startedBy} · ${fmtTime(round.startedAt)}</span></div>
          <div class="progress"><i style=${`width:${list.length ? (checked.length / list.length) * 100 : 0}%`}></i></div>
          <div class="row between">
            <span><b>${checked.length}</b> / ${list.length} checked</span>
            <button class="btn dark sm" disabled=${checked.length < list.length} onClick=${completeRound}>Complete check</button>
          </div>
          ${checked.length < list.length ? html`<div class="small muted">Red items aren't checked yet. You can finish when every item is done.</div>` : ''}
        ` : html`
          <div class="row between"><div>
            <b>${round?.completedAt ? 'Last check done' : 'No check running'}</b>
            ${round?.completedAt ? html`<div class="small muted">by ${round.completedBy} · ${fmtTime(round.completedAt)}</div>` : ''}
          </div>
          <button class="btn primary sm" onClick=${startRound}>Start check</button></div>
        `}
      </div>
      ${sections.map((sec) => html`
        <div class="section-h">${sec}</div>
        ${list.filter((i) => (i.section || 'Other') === sec).map((i) => html`<${StockRow} key=${i.id} item=${i} roundOpen=${roundOpen} round=${round} onSet=${setQty} />`)}
      `)}`}
    ` : mode === 'order' ? html`<${OrderList} items=${low} me=${me} toast=${toast} />` : html`<${ManageStock} items=${list} code=${code} toast=${toast} />`}
  </div>`;
}

function StockRow({ item, roundOpen, round, onSet }) {
  const [v, setV] = useState(item.qty == null ? '' : String(item.qty));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(item.qty == null ? '' : String(item.qty)); }, [item.qty]);
  const done = roundOpen && item.checkedRound === round.id;
  const cls = !roundOpen ? 'idle' : done ? 'done' : 'todo';
  const isLow = item.qty != null && item.par != null && item.qty < item.par;
  const commit = (val) => { const n = num(val); if (n != null) onSet(item, n); };
  const step = (d) => { const n = Math.max(0, (num(v) ?? 0) + d); setV(String(n)); onSet(item, n); };
  return html`<div class=${'item ' + cls}>
    <div>
      <div class="nm">${item.name}</div>
      <div class="meta">Par ${fmtNum(item.par)} ${item.unit || ''}${isLow ? html` · <span class="low">Low</span>` : ''}</div>
      ${item.checkedBy ? html`<div class="meta">${done ? '✓ ' : ''}${item.checkedBy} · ${fmtTime(item.checkedAt)}</div>` : ''}
    </div>
    <div class="stepper">
      <button aria-label="minus" onClick=${() => step(-1)}>−</button>
      <input inputmode="decimal" value=${v} placeholder="—"
        onFocus=${() => { focused.current = true; }}
        onBlur=${(e) => { focused.current = false; if (e.target.value !== (item.qty == null ? '' : String(item.qty))) commit(e.target.value); }}
        onInput=${(e) => setV(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      <button aria-label="plus" onClick=${() => step(1)}>+</button>
    </div>
  </div>`;
}

function OrderList({ items, me, toast }) {
  if (!items.length) return html`<div class="card empty">Nothing below par. 👍</div>`;
  async function toggle(i) {
    try { await updateDoc(doc(db, 'inventory_items', i.id), { ordered: !i.ordered, orderedBy: !i.ordered ? me.name : '', orderedAt: serverTimestamp() }); }
    catch (e) { toast('Could not save — check internet'); }
  }
  async function note(i, n) { try { await updateDoc(doc(db, 'inventory_items', i.id), { orderNote: n }); } catch (e) { toast('Could not save'); } }
  const todo = items.filter((i) => !i.ordered), done = items.filter((i) => i.ordered);
  const Row = (i) => html`<div class="card" key=${i.id}>
    <div class="row between">
      <div class="grow"><b>${i.name}</b>
        <div class="small muted">Have ${fmtNum(i.qty)} · Par ${fmtNum(i.par)} · Need <b style="color:var(--ink)">${fmtNum(Math.max(0, i.par - i.qty))} ${i.unit || ''}</b></div>
        ${i.ordered ? html`<div class="small" style="color:var(--good);font-weight:650">Ordered by ${i.orderedBy} · ${fmtTime(i.orderedAt)}</div>` : ''}
      </div>
      <button class=${'btn sm ' + (i.ordered ? '' : 'primary')} onClick=${() => toggle(i)}>${i.ordered ? 'Undo' : 'Mark ordered'}</button>
    </div>
    <input style="margin-top:8px;padding:8px 10px;font-size:14px" placeholder="Note (e.g. arrives Tue)" value=${i.orderNote || ''} onBlur=${(e) => e.target.value !== (i.orderNote || '') && note(i, e.target.value)} />
  </div>`;
  return html`
    <div class="small muted">${todo.length} to order · ${done.length} ordered. Items clear automatically once they're back above par.</div>
    ${todo.map(Row)}
    ${done.length ? html`<div class="section-h">Ordered</div>${done.map(Row)}` : ''}`;
}

function ManageStock({ items, code, toast }) {
  const [f, setF] = useState({ name: '', section: '', unit: '', par: '' });
  const [edit, setEdit] = useState(null);
  const sections = [...new Set(items.map((i) => i.section).filter(Boolean))];
  async function add() {
    if (!f.name.trim()) return toast('Enter an item name');
    try {
      await addDoc(collection(db, 'inventory_items'), {
        kitchenCode: code, name: f.name.trim(), section: f.section.trim() || 'Other', unit: f.unit.trim(), par: num(f.par),
        order: Date.now(), active: true, qty: null, ordered: false,
      });
      setF({ ...f, name: '', par: '' });
      toast('Added');
    } catch (e) { console.error(e); toast('Could not add — check internet'); }
  }
  async function saveEdit() {
    try {
      await updateDoc(doc(db, 'inventory_items', edit.id), { name: edit.name.trim(), section: edit.section.trim() || 'Other', unit: edit.unit.trim(), par: num(edit.par) });
      setEdit(null); toast('Saved');
    } catch (e) { toast('Could not save'); }
  }
  async function remove(i) {
    if (!confirm(`Delete "${i.name}"?`)) return;
    try { await deleteDoc(doc(db, 'inventory_items', i.id)); setEdit(null); } catch (e) { toast('Could not delete'); }
  }
  return html`
    <div class="card stack">
      <h3 style="margin:0">Add item</h3>
      <input placeholder="Item (e.g. Onion)" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} />
      <div class="grid3">
        <div><input list="secs" placeholder="Area" value=${f.section} onInput=${(e) => setF({ ...f, section: e.target.value })} /></div>
        <div><input placeholder="Unit" value=${f.unit} onInput=${(e) => setF({ ...f, unit: e.target.value })} /></div>
        <div><input inputmode="decimal" placeholder="Par" value=${f.par} onInput=${(e) => setF({ ...f, par: e.target.value })} /></div>
      </div>
      <datalist id="secs">${['Walk-in', 'Freezer', 'Dry storage', 'Line', 'Bar', ...sections].filter((v, i, a) => a.indexOf(v) === i).map((s) => html`<option value=${s} />`)}</datalist>
      <div class="small muted">Area groups items in the order you walk the kitchen. Par = the minimum you want on hand.</div>
      <button class="btn dark" onClick=${add}>Add item</button>
    </div>
    <div class="card">
      <h3>${items.length} items</h3>
      <div class="list">
        ${items.map((i) => edit?.id === i.id ? html`<div class="li" style="flex-direction:column;align-items:stretch">
            <input value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} />
            <div class="grid3">
              <input list="secs" value=${edit.section} onInput=${(e) => setEdit({ ...edit, section: e.target.value })} />
              <input value=${edit.unit} onInput=${(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="Unit" />
              <input inputmode="decimal" value=${edit.par} onInput=${(e) => setEdit({ ...edit, par: e.target.value })} placeholder="Par" />
            </div>
            <div class="row"><button class="btn dark sm" onClick=${saveEdit}>Save</button><button class="btn sm" onClick=${() => setEdit(null)}>Cancel</button><span class="grow"></span><button class="btn sm danger" onClick=${() => remove(i)}>Delete</button></div>
          </div>` : html`<button class="li" style="border-left:0;border-right:0;border-top:0;background:none;text-align:left;width:100%" onClick=${() => setEdit({ id: i.id, name: i.name, section: i.section || '', unit: i.unit || '', par: i.par == null ? '' : String(i.par) })}>
            <div class="grow"><div class="t">${i.name}</div><div class="s">${i.section || 'Other'} · Par ${fmtNum(i.par)} ${i.unit || ''}</div></div>
            <span class="small muted">Edit</span></button>`)}
      </div>
    </div>`;
}

/* ================= COST ================= */
const UNITS = { g: ['mass', 1], kg: ['mass', 1000], lb: ['mass', 453.592], oz: ['mass', 28.3495], ml: ['vol', 1], L: ['vol', 1000], ea: ['count', 1] };
const unitsFor = (u) => Object.keys(UNITS).filter((k) => UNITS[k][0] === (UNITS[u] || UNITS.ea)[0]);
const costPerBase = (ing) => {
  const p = num(ing.packPrice), q = num(ing.packQty), y = num(ing.yieldPct) || 100;
  const f = (UNITS[ing.packUnit] || UNITS.ea)[1];
  if (!p || !q) return null;
  return p / (q * f) / (y / 100);
};
const lineCost = (line, ingMap) => {
  const ing = ingMap[line.ingredientId]; if (!ing) return null;
  const c = costPerBase(ing), q = num(line.qty); if (c == null || q == null) return null;
  const u = UNITS[line.unit] && UNITS[line.unit][0] === (UNITS[ing.packUnit] || UNITS.ea)[0] ? line.unit : ing.packUnit;
  return q * (UNITS[u] || UNITS.ea)[1] * c;
};
const menuCost = (m, ingMap) => (m.lines || []).reduce((s, l) => s + (lineCost(l, ingMap) || 0), 0);
const pctBadge = (pct, target) => (pct == null ? 'neutral' : pct <= target ? 'good' : pct <= target + 5 ? 'warn' : 'bad');

function CostView({ kitchen, code, toast }) {
  const ings = useCollection('ingredients', code);
  const menus = useCollection('menus', code);
  const [mode, setMode] = useState('menus');
  const [editMenu, setEditMenu] = useState(null);
  const [editIng, setEditIng] = useState(null);
  const target = kitchen?.targetPct ?? 30;
  const ingMap = useMemo(() => Object.fromEntries((ings || []).map((i) => [i.id, i])), [ings]);
  const rows = useMemo(() => (menus || []).map((m) => { const c = menuCost(m, ingMap); const p = num(m.price); return { ...m, cost: c, pct: p ? (c / p) * 100 : null }; }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)), [menus, ingMap]);
  const withPct = rows.filter((r) => r.pct != null);
  const avg = withPct.length ? withPct.reduce((s, r) => s + r.pct, 0) / withPct.length : null;
  const over = withPct.filter((r) => r.pct > target).length;

  return html`
  <div class="page">
    <div class="seg">
      <button class=${mode === 'menus' ? 'on' : ''} onClick=${() => setMode('menus')}>Menu items</button>
      <button class=${mode === 'ings' ? 'on' : ''} onClick=${() => setMode('ings')}>Ingredients</button>
    </div>
    ${(ings === null || menus === null) ? html`<div class="card empty">Loading…</div>` : mode === 'menus' ? html`
      <div class="card grid2">
        <div class="stat"><b>${avg == null ? '—' : avg.toFixed(1) + '%'}</b><span>Average food cost</span></div>
        <div class="stat"><b style=${over ? 'color:var(--bad)' : ''}>${over}</b><span>Over ${target}% target</span></div>
      </div>
      <button class="btn primary" onClick=${() => setEditMenu({ name: '', price: '', lines: [] })} disabled=${!ings.length}>+ New menu item</button>
      ${!ings.length ? html`<div class="hint">Add your ingredients first (with what you pay for them). Then build menu items from them.</div>` : ''}
      ${rows.length === 0 && ings.length ? html`<div class="card empty">No menu items yet.</div>` : ''}
      ${rows.map((m) => html`<button class="card" key=${m.id} style="text-align:left;width:100%" onClick=${() => setEditMenu({ ...m, price: m.price == null ? '' : String(m.price), lines: (m.lines || []).map((l) => ({ ...l, qty: l.qty == null ? '' : String(l.qty) })) })}>
        <div class="row between"><b>${m.name}</b><span class=${'badge ' + pctBadge(m.pct, target)}>${m.pct == null ? 'No price' : m.pct.toFixed(1) + '%'}</span></div>
        <div class="small muted" style="margin-top:4px">Price ${money(num(m.price))} · Plate cost ${money(m.cost)} · ${(m.lines || []).length} ingredients</div>
      </button>`)}
    ` : html`
      <button class="btn primary" onClick=${() => setEditIng({ name: '', packPrice: '', packQty: '', packUnit: 'kg', yieldPct: '100' })}>+ New ingredient</button>
      <div class="small muted">When a price changes, update it here — every menu item using it updates automatically.</div>
      ${ings.length === 0 ? html`<div class="card empty">No ingredients yet.</div>` : html`<div class="card"><div class="list">
        ${[...ings].sort((a, b) => a.name.localeCompare(b.name)).map((i) => { const c = costPerBase(i); const f = (UNITS[i.packUnit] || UNITS.ea)[1]; return html`<button class="li" style="border-left:0;border-right:0;border-top:0;background:none;text-align:left;width:100%" onClick=${() => setEditIng({ ...i, packPrice: String(i.packPrice ?? ''), packQty: String(i.packQty ?? ''), yieldPct: String(i.yieldPct ?? 100) })}>
          <div class="grow"><div class="t">${i.name}</div><div class="s">${money(num(i.packPrice))} for ${fmtNum(num(i.packQty))} ${i.packUnit}${num(i.yieldPct) && num(i.yieldPct) !== 100 ? ` · ${i.yieldPct}% yield` : ''}</div></div>
          <span class="small" style="font-family:var(--mono);font-weight:700">${c == null ? '—' : money(c * f) + '/' + i.packUnit}</span></button>`; })}
      </div></div>`}
    `}
    ${editMenu && html`<${MenuEditor} m=${editMenu} ings=${ings} ingMap=${ingMap} code=${code} target=${target} toast=${toast} onClose=${() => setEditMenu(null)} />`}
    ${editIng && html`<${IngEditor} i=${editIng} code=${code} toast=${toast} onClose=${() => setEditIng(null)} />`}
  </div>`;
}

function Sheet({ title, onClose, children }) {
  return html`<div class="sheet-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-label=${title}>
      <div class="sheet-head"><h2>${title}</h2><button class="icon-btn" aria-label="Close" onClick=${onClose}>${Icon.close}</button></div>
      ${children}
    </div></div>`;
}

function IngEditor({ i, code, toast, onClose }) {
  const [f, setF] = useState(i);
  const c = costPerBase(f);
  async function save() {
    if (!f.name.trim()) return toast('Enter a name');
    const data = { kitchenCode: code, name: f.name.trim(), packPrice: num(f.packPrice), packQty: num(f.packQty), packUnit: f.packUnit, yieldPct: num(f.yieldPct) || 100, updatedAt: serverTimestamp() };
    try { if (f.id) await updateDoc(doc(db, 'ingredients', f.id), data); else await addDoc(collection(db, 'ingredients'), data); toast('Saved'); onClose(); }
    catch (e) { console.error(e); toast('Could not save — check internet'); }
  }
  async function remove() {
    if (!confirm(`Delete "${f.name}"? Menu items using it will lose this line's cost.`)) return;
    try { await deleteDoc(doc(db, 'ingredients', f.id)); onClose(); } catch (e) { toast('Could not delete'); }
  }
  return html`<${Sheet} title=${f.id ? 'Edit ingredient' : 'New ingredient'} onClose=${onClose}>
    <div><label>Name</label><input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Onion" /></div>
    <div><label>What you pay</label>
      <div class="grid3">
        <input inputmode="decimal" value=${f.packPrice} onInput=${(e) => setF({ ...f, packPrice: e.target.value })} placeholder="$ Price" />
        <input inputmode="decimal" value=${f.packQty} onInput=${(e) => setF({ ...f, packQty: e.target.value })} placeholder="Amount" />
        <select value=${f.packUnit} onChange=${(e) => setF({ ...f, packUnit: e.target.value })}>${Object.keys(UNITS).map((u) => html`<option value=${u}>${u}</option>`)}</select>
      </div>
      <div class="small muted" style="margin-top:6px">Example: $15 for 10 kg</div>
    </div>
    <div><label>Yield % (usable after trimming/peeling)</label><input inputmode="decimal" value=${f.yieldPct} onInput=${(e) => setF({ ...f, yieldPct: e.target.value })} placeholder="100" /></div>
    <div class="card row between"><span class="muted">Real cost</span><b style="font-family:var(--mono)">${c == null ? '—' : `${money(c * (UNITS[f.packUnit] || UNITS.ea)[1])} / ${f.packUnit}`}</b></div>
    <button class="btn primary block" onClick=${save}>Save</button>
    ${f.id && html`<button class="btn danger ghost block" onClick=${remove}>Delete ingredient</button>`}
  <//>`;
}

function MenuEditor({ m, ings, ingMap, code, target, toast, onClose }) {
  const [f, setF] = useState(m);
  const sorted = [...ings].sort((a, b) => a.name.localeCompare(b.name));
  const cost = menuCost(f, ingMap);
  const price = num(f.price);
  const pct = price ? (cost / price) * 100 : null;
  const setLine = (idx, patch) => setF({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const addLine = () => { const ing = sorted[0]; setF({ ...f, lines: [...f.lines, { ingredientId: ing.id, qty: '', unit: ing.packUnit === 'kg' ? 'g' : ing.packUnit === 'L' ? 'ml' : ing.packUnit }] }); };
  async function save() {
    if (!f.name.trim()) return toast('Enter a name');
    const data = { kitchenCode: code, name: f.name.trim(), price: num(f.price), lines: f.lines.map((l) => ({ ingredientId: l.ingredientId, qty: num(l.qty), unit: l.unit })), updatedAt: serverTimestamp() };
    try { if (f.id) await updateDoc(doc(db, 'menus', f.id), data); else await addDoc(collection(db, 'menus'), data); toast('Saved'); onClose(); }
    catch (e) { console.error(e); toast('Could not save — check internet'); }
  }
  async function remove() {
    if (!confirm(`Delete "${f.name}"?`)) return;
    try { await deleteDoc(doc(db, 'menus', f.id)); onClose(); } catch (e) { toast('Could not delete'); }
  }
  const suggested = cost && target ? cost / (target / 100) : null;
  return html`<${Sheet} title=${f.id ? 'Edit menu item' : 'New menu item'} onClose=${onClose}>
    <div class="grid2">
      <div><label>Name</label><input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Bibimbap" /></div>
      <div><label>Menu price $</label><input inputmode="decimal" value=${f.price} onInput=${(e) => setF({ ...f, price: e.target.value })} placeholder="0.00" /></div>
    </div>
    <div>
      <label>Ingredients per plate</label>
      <div class="stack">
        ${f.lines.map((l, idx) => { const ing = ingMap[l.ingredientId]; const lc = lineCost(l, ingMap); return html`<div>
          <div class="line-row">
            <select value=${l.ingredientId} onChange=${(e) => { const ni = ingMap[e.target.value]; setLine(idx, { ingredientId: e.target.value, unit: unitsFor(ni?.packUnit).includes(l.unit) ? l.unit : ni?.packUnit }); }}>
              ${sorted.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
            </select>
            <input inputmode="decimal" value=${l.qty} onInput=${(e) => setLine(idx, { qty: e.target.value })} placeholder="Qty" />
            <select value=${l.unit} onChange=${(e) => setLine(idx, { unit: e.target.value })}>${unitsFor(ing?.packUnit).map((u) => html`<option value=${u}>${u}</option>`)}</select>
            <button class="btn ghost sm" aria-label="Remove" style="padding:0;min-height:34px" onClick=${() => setF({ ...f, lines: f.lines.filter((_, i) => i !== idx) })}>✕</button>
          </div>
          <div class="line-cost">${lc == null ? '' : money(lc)}</div>
        </div>`; })}
        <button class="btn sm" onClick=${addLine}>+ Add ingredient</button>
      </div>
    </div>
    <div class="card grid2">
      <div class="stat"><b>${money(cost)}</b><span>Plate cost</span></div>
      <div class="stat"><b style=${pct != null && pct > target ? 'color:var(--bad)' : ''}>${pct == null ? '—' : pct.toFixed(1) + '%'}</b><span>Food cost (target ${target}%)</span></div>
    </div>
    ${suggested ? html`<div class="small muted">To hit ${target}%, the price would be about <b style="color:var(--ink)">${money(suggested)}</b>.</div>` : ''}
    <button class="btn primary block" onClick=${save}>Save</button>
    ${f.id && html`<button class="btn danger ghost block" onClick=${remove}>Delete menu item</button>`}
  <//>`;
}

/* ================= SETTINGS ================= */
function SettingsSheet({ kitchen, code, me, user, metrics, toast, onClose, onLeft }) {
  const [name, setName] = useState(me.name);
  const [kname, setKname] = useState(kitchen.name || '');
  const [target, setTarget] = useState(String(kitchen.targetPct ?? 30));
  const [place, setPlace] = useState(kitchen.place || '');
  const [newMetric, setNewMetric] = useState('');
  const list = (metrics || []).slice().sort(byOrder);

  async function saveProfile() {
    try {
      if (name.trim() && name.trim() !== me.name) { await updateDoc(doc(db, 'members', user.uid), { name: name.trim() }); localStorage.setItem('mb_name', name.trim()); }
      await updateDoc(doc(db, 'kitchens', code), { name: kname.trim() || kitchen.name, targetPct: num(target) || 30, place: place.trim() });
      toast('Saved');
    } catch (e) { console.error(e); toast('Could not save'); }
  }
  function useMyLocation() {
    if (!navigator.geolocation) return toast('Location not available');
    navigator.geolocation.getCurrentPosition(async (p) => {
      try { await updateDoc(doc(db, 'kitchens', code), { lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4), place: place.trim() || 'Kitchen location' }); toast('Location saved for weather'); }
      catch (e) { toast('Could not save'); }
    }, () => toast('Location permission denied'));
  }
  async function addMetric() {
    if (!newMetric.trim()) return;
    try { await addDoc(collection(db, 'metrics'), { kitchenCode: code, name: newMetric.trim(), order: (list.at(-1)?.order ?? 0) + 1, active: true }); setNewMetric(''); }
    catch (e) { toast('Could not add'); }
  }
  async function patchMetric(m, patch) { try { await updateDoc(doc(db, 'metrics', m.id), patch); } catch (e) { toast('Could not save'); } }
  async function move(idx, dir) {
    const a = list[idx], b = list[idx + dir]; if (!a || !b) return;
    await patchMetric(a, { order: b.order ?? idx + dir }); await patchMetric(b, { order: a.order ?? idx });
  }
  async function removeMetric(m) {
    if (!confirm(`Delete "${m.name}"? Old logs keep their numbers.`)) return;
    try { await deleteDoc(doc(db, 'metrics', m.id)); } catch (e) { toast('Could not delete'); }
  }
  async function share() {
    const text = `Join our kitchen on MiseBook: code ${code}\n${location.origin}`;
    try { if (navigator.share) await navigator.share({ title: 'MiseBook', text }); else { await navigator.clipboard.writeText(text); toast('Copied'); } } catch (e) {}
  }
  async function leave() {
    if (!confirm('Leave this kitchen on this phone? You can rejoin with the code.')) return;
    try { await deleteDoc(doc(db, 'members', user.uid)); onLeft(); } catch (e) { toast('Could not leave'); }
  }

  return html`<${Sheet} title="Settings" onClose=${onClose}>
    <div class="card stack">
      <h3 style="margin:0">Kitchen code</h3>
      <div class="code-box">${code}</div>
      <button class="btn dark" onClick=${share}>Share code with team</button>
      <div class="small muted">Anyone with this code can see and edit this kitchen's data. Share it only with your team.</div>
    </div>

    <div class="card stack">
      <h3 style="margin:0">Daily log items</h3>
      <div class="small muted">Numbers your team logs each day. Hide ones you don't use.</div>
      <div class="list">
        ${list.map((m, idx) => html`<div class="li" key=${m.id}>
          <input class="grow" style="padding:8px 10px" value=${m.name} onBlur=${(e) => e.target.value.trim() && e.target.value.trim() !== m.name && patchMetric(m, { name: e.target.value.trim() })} />
          <button class="btn sm" aria-label="Move up" disabled=${idx === 0} onClick=${() => move(idx, -1)}>↑</button>
          <button class=${'btn sm' + (m.active === false ? '' : ' dark')} onClick=${() => patchMetric(m, { active: m.active === false })}>${m.active === false ? 'Hidden' : 'On'}</button>
          <button class="btn sm danger" aria-label="Delete" onClick=${() => removeMetric(m)}>✕</button>
        </div>`)}
      </div>
      <div class="row"><input class="grow" value=${newMetric} onInput=${(e) => setNewMetric(e.target.value)} placeholder="e.g. Sales $, Delivery orders" onKeyDown=${(e) => e.key === 'Enter' && addMetric()} /><button class="btn dark" onClick=${addMetric}>Add</button></div>
    </div>

    <div class="card stack">
      <h3 style="margin:0">Kitchen</h3>
      <div><label>Your name</label><input value=${name} onInput=${(e) => setName(e.target.value)} /></div>
      <div><label>Kitchen name</label><input value=${kname} onInput=${(e) => setKname(e.target.value)} /></div>
      <div><label>Food cost target %</label><input inputmode="decimal" value=${target} onInput=${(e) => setTarget(e.target.value)} /></div>
      <div><label>Weather location</label><input value=${place} onInput=${(e) => setPlace(e.target.value)} placeholder="Vancouver, BC" />
        <div class="small muted" style="margin-top:6px">Using ${kitchen.lat}, ${kitchen.lon}.</div></div>
      <button class="btn sm" onClick=${useMyLocation}>Use my current location for weather</button>
      <button class="btn primary" onClick=${saveProfile}>Save</button>
    </div>

    <div class="card stack">
      <h3 style="margin:0">Install on your phone</h3>
      <div class="small">iPhone: open in Safari → Share → <b>Add to Home Screen</b>.<br/>Android: Chrome menu → <b>Install app</b>.</div>
    </div>
    <button class="btn danger ghost" onClick=${leave}>Leave kitchen on this phone</button>
    <div class="small muted" style="text-align:center">MiseBook by Pixel Pantry</div>
  <//>`;
}

/* ================= APP ================= */
function App() {
  const [user, setUser] = useState(null);
  const [member, setMember] = useState(undefined);
  const [kitchen, setKitchen] = useState(undefined);
  const [tab, setTab] = useState(localStorage.getItem('mb_tab') || 'log');
  const [settings, setSettings] = useState(false);
  const [fatal, setFatal] = useState('');
  const [msg, toast] = useToast();
  const metrics = useCollection('metrics', member?.kitchenCode);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    if (u) setUser(u);
    else signInAnonymously(auth).catch((e) => { console.error(e); setFatal('Could not connect. Check your internet and reload.'); });
  }), []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'members', user.uid), (s) => setMember(s.exists() ? s.data() : null), (e) => { console.error(e); setMember(null); });
  }, [user]);

  useEffect(() => {
    if (!member?.kitchenCode) { setKitchen(undefined); return; }
    return onSnapshot(doc(db, 'kitchens', member.kitchenCode), (s) => setKitchen(s.exists() ? s.data() : null), (e) => { console.error(e); setKitchen(null); });
  }, [member?.kitchenCode]);

  useEffect(() => { localStorage.setItem('mb_tab', tab); }, [tab]);

  if (fatal) return html`<div class="boot"><div class="boot-mark">MiseBook</div><div class="err">${fatal}</div></div>`;
  if (!user || member === undefined) return html`<div class="boot"><div class="boot-mark">MiseBook</div><div class="boot-sub">Loading…</div></div>`;
  if (!member) return html`<${JoinScreen} user=${user} onJoined=${() => {}} />`;
  if (kitchen === undefined) return html`<div class="boot"><div class="boot-mark">MiseBook</div><div class="boot-sub">Opening kitchen…</div></div>`;
  if (kitchen === null) return html`<div class="boot"><div class="boot-mark">MiseBook</div><div class="err">This kitchen no longer exists.</div>
    <button class="btn" style="margin-top:12px" onClick=${() => deleteDoc(doc(db, 'members', user.uid))}>Join another kitchen</button></div>`;

  const code = member.kitchenCode;
  const me = { name: member.name || 'Someone' };
  const titles = { log: 'Daily log', stock: 'Stock check', cost: 'Food cost' };

  return html`
  <div class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-name">${titles[tab]}</div><div class="brand-sub">${kitchen.name} · ${me.name}</div></div>
      <button class="icon-btn" aria-label="Settings" onClick=${() => setSettings(true)}>${Icon.gear}</button>
    </header>
    ${tab === 'log' && html`<${LogView} kitchen=${kitchen} code=${code} me=${me} metrics=${metrics} toast=${toast} />`}
    ${tab === 'stock' && html`<${StockView} kitchen=${kitchen} code=${code} me=${me} toast=${toast} />`}
    ${tab === 'cost' && html`<${CostView} kitchen=${kitchen} code=${code} toast=${toast} />`}
    <nav class="tabbar"><div class="tabbar-in">
      <button class=${'tab' + (tab === 'log' ? ' on' : '')} onClick=${() => setTab('log')}>${Icon.log}Log</button>
      <button class=${'tab' + (tab === 'stock' ? ' on' : '')} onClick=${() => setTab('stock')}>${Icon.stock}Stock</button>
      <button class=${'tab' + (tab === 'cost' ? ' on' : '')} onClick=${() => setTab('cost')}>${Icon.cost}Cost</button>
    </div></nav>
    ${settings && html`<${SettingsSheet} kitchen=${kitchen} code=${code} me=${me} user=${user} metrics=${metrics} toast=${toast} onClose=${() => setSettings(false)} onLeft=${() => setSettings(false)} />`}
    ${msg && html`<div class="toast" role="status">${msg}</div>`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
