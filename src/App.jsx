import { useState, useEffect, useCallback } from "react";

// ── CONFIGURATION ──────────────────────────────────────────────────────────
// Paste your Google Apps Script Web App URL here after setup:
const SHEET_URL = "https://teamscoreboard-proxy.eugenia.workers.dev";

// ── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_TARGETS = { meetings: 30, trips: 8, outreach: 50 };

const GOAL_META = {
  meetings: { icon: "🤝", label: "Meet",      color: "#1D6FA4", bg: "#EBF4FB", border: "#9BC8E8" },
  trips:    { icon: "✈️", label: "Travel",    color: "#0B8A72", bg: "#E6F5F2", border: "#7ECBB8" },
  outreach: { icon: "🗣️", label: "Reach Out", color: "#5B4FCF", bg: "#F0EEFF", border: "#ADA3E8" },
};

const CHEERS = [
  "Every hello is the start of something great! 🌟",
  "The world opens up to those who show up! 🌍",
  "Each outreach is a seed of opportunity! 🌱",
  "Travel broadens the mind and the network! ✈️",
  "More meetings = more possibilities! 🤝",
  "Keep going — every action compounds! 🚀",
];

// ── Date helpers ───────────────────────────────────────────────────────────
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function toMonthKey(dateStr) { return dateStr.slice(0, 7); }
function toWeekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return localDateStr(d);
}
function monthLabel(mk) {
  const [y, m] = mk.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function weekLabel(wk) {
  const [y, m, d] = wk.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function todayStr() { return localDateStr(new Date()); }
function currentMonthKey() { return todayStr().slice(0, 7); }
function currentWeekKey() { return toWeekKey(todayStr()); }

// ── Derive aggregates ──────────────────────────────────────────────────────
function deriveMonthly(entries) {
  const map = {};
  for (const e of entries) {
    const mk = toMonthKey(e.date);
    if (!map[mk]) map[mk] = { meetings: 0, trips: 0, outreach: 0 };
    map[mk][e.goal] = (map[mk][e.goal] || 0) + 1;
  }
  return map;
}
function deriveWeekly(entries, goal) {
  const map = {};
  for (const e of entries) {
    if (e.goal !== goal) continue;
    const wk = toWeekKey(e.date);
    map[wk] = (map[wk] || 0) + 1;
  }
  return map;
}

// ── Google Sheets API ──────────────────────────────────────────────────────
async function sheetRead() {
  // Google Apps Script redirects — we need to follow redirects with cors mode
  const url = `${SHEET_URL}?action=read&t=${Date.now()}`;
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    mode: "cors",
    cache: "no-cache",
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Bad response: " + text.slice(0, 100)); }
}
async function sheetWrite(data) {
  const res = await fetch(SHEET_URL, {
    method: "POST",
    redirect: "follow",
    mode: "cors",
    cache: "no-cache",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "write", data }),
  });
  const text = await res.text();
  return text;
}

// ── Ring ───────────────────────────────────────────────────────────────────
function Ring({ pct, color, size = 110, stroke = 11 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = Math.min(1, pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block", margin: "0 auto" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E2EEF5" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s cubic-bezier(.4,2,.6,1)" }} />
    </svg>
  );
}

// ── History bars ───────────────────────────────────────────────────────────
function HistoryBars({ bars, color, bg }) {
  const maxVal = Math.max(...bars.map(b => b.value), 1);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 60 }}>
      {bars.map((b, i) => {
        const isCurrent = i === bars.length - 1;
        const h = Math.max(4, Math.round((b.value / maxVal) * 42));
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ fontSize: 10, fontFamily: "system-ui,sans-serif", fontWeight: isCurrent ? 800 : 500, color: isCurrent ? color : "#9BAAB8" }}>{b.value}</div>
            <div style={{ width: "100%", borderRadius: 5, height: h, background: isCurrent ? color : bg, border: `1.5px solid ${isCurrent ? color : "#D4E4EE"}`, transition: "height 0.6s ease" }} />
            <div style={{ fontSize: 8, fontFamily: "system-ui,sans-serif", fontWeight: isCurrent ? 700 : 400, color: isCurrent ? color : "#BACAD6", textAlign: "center", lineHeight: 1.2 }}>{b.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [entries, setEntries]     = useState([]);
  const [targets, setTargets]     = useState(DEFAULT_TARGETS);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);
  const [tab, setTab]             = useState("board");
  const [toast, setToast]         = useState(null);
  const [logGoal, setLogGoal]     = useState("");
  const [logDate, setLogDate]     = useState(todayStr());
  const [logDetail, setLogDetail] = useState({ who: "", where: "", whom: "", about: "" });
  const [histGoal, setHistGoal]   = useState("meetings");
  const [editTargets, setEditTargets] = useState(DEFAULT_TARGETS);
  const [targetsSaved, setTargetsSaved] = useState(false);

  const isConfigured = !SHEET_URL.includes("YOUR_APPS_SCRIPT_URL_HERE");

  // ── Load from Sheet ──
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sheetRead();
      setEntries(data.entries || []);
      const t = data.targets || DEFAULT_TARGETS;
      setTargets(t);
      setEditTargets(t);
    } catch (e) {
      setError("Error: " + e.message + " — if this says 'Failed to fetch' or 'CORS', the browser is blocking the request. Please let your developer know.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isConfigured) loadData(); else setLoading(false); }, [loadData, isConfigured]);

  // ── Save to Sheet ──
  const saveData = useCallback(async (newEntries, newTargets) => {
    setSaving(true);
    try {
      await sheetWrite({ entries: newEntries, targets: newTargets });
    } catch {
      fireToast("⚠️ Save failed — check your connection.");
    }
    setSaving(false);
  }, []);

  const fireToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3400); };

  // ── Derived ──
  const monthly = deriveMonthly(entries);
  const cmk = currentMonthKey();
  const cwk = currentWeekKey();
  const curMonth = monthly[cmk] || { meetings: 0, trips: 0, outreach: 0 };
  const overallPct = Math.round(
    Object.keys(GOAL_META).reduce((s, k) => s + Math.min(100, ((curMonth[k] || 0) / targets[k]) * 100), 0) / 3
  );
  const cheerIdx = Math.floor(Date.now() / 9000) % CHEERS.length;

  // ── Bar builders ──
  function getLast5WeekKeys() {
    const keys = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(cwk + "T00:00:00");
      d.setDate(d.getDate() - i * 7);
      keys.push(localDateStr(d));
    }
    return keys;
  }
  function getLast5MonthKeys() {
    const keys = [];
    const [cy, cm] = cmk.split("-").map(Number);
    for (let i = 4; i >= 0; i--) {
      let mo = cm - i; let yr = cy;
      while (mo <= 0) { mo += 12; yr--; }
      keys.push(`${yr}-${String(mo).padStart(2, "0")}`);
    }
    return keys;
  }
  function getMeetingsBars() {
    const wMap = deriveWeekly(entries, "meetings");
    return getLast5WeekKeys().map(wk => ({ label: weekLabel(wk), value: wMap[wk] || 0 }));
  }
  function getTripsBars() {
    return getLast5MonthKeys().map(mk => ({ label: monthLabel(mk), value: (monthly[mk] || {}).trips || 0 }));
  }
  function getOutreachBars() {
    const wMap = deriveWeekly(entries, "outreach");
    return getLast5WeekKeys().map(wk => ({ label: weekLabel(wk), value: wMap[wk] || 0 }));
  }
  function allMonthsSorted() {
    const mks = [...new Set([...Object.keys(monthly), cmk])].sort().reverse();
    return mks.map(mk => ({
      key: mk, label: monthLabel(mk),
      meetings: (monthly[mk] || {}).meetings || 0,
      trips:    (monthly[mk] || {}).trips    || 0,
      outreach: (monthly[mk] || {}).outreach || 0,
    }));
  }

  // ── Log ──
  const canSubmit = () => {
    if (!logGoal) return false;
    if (logGoal === "meetings" && !logDetail.who.trim())    return false;
    if (logGoal === "trips"    && !logDetail.where.trim())  return false;
    if (logGoal === "outreach" && (!logDetail.whom.trim() || !logDetail.about.trim())) return false;
    return true;
  };
  const submitLog = async () => {
    if (!canSubmit()) return;
    let detail = "";
    if (logGoal === "meetings") detail = `Met ${logDetail.who}`;
    if (logGoal === "trips")    detail = `Traveled to ${logDetail.where}`;
    if (logGoal === "outreach") detail = `Reached out to ${logDetail.whom} about ${logDetail.about}`;
    const entry = { id: Date.now(), goal: logGoal, detail, date: logDate, ts: Date.now() };
    const newEntries = [entry, ...entries];
    setEntries(newEntries);
    await saveData(newEntries, targets);
    const msgs = {
      meetings: `🤝 Logged! Great connection with ${logDetail.who}!`,
      trips:    `✈️ ${logDetail.where} logged! Every trip counts.`,
      outreach: `🗣️ Outreach to ${logDetail.whom} recorded!`,
    };
    fireToast(msgs[logGoal]);
    setLogGoal(""); setLogDate(todayStr());
    setLogDetail({ who: "", where: "", whom: "", about: "" });
  };

  // ── Delete ──
  const deleteEntry = async (id) => {
    const newEntries = entries.filter(e => e.id !== id);
    setEntries(newEntries);
    await saveData(newEntries, targets);
    fireToast("Entry deleted.");
  };

  // ── Save targets ──
  const saveTargets = async () => {
    const t = {
      meetings: Math.max(1, parseInt(editTargets.meetings) || DEFAULT_TARGETS.meetings),
      trips:    Math.max(1, parseInt(editTargets.trips)    || DEFAULT_TARGETS.trips),
      outreach: Math.max(1, parseInt(editTargets.outreach) || DEFAULT_TARGETS.outreach),
    };
    setTargets(t); setEditTargets(t);
    await saveData(entries, t);
    setTargetsSaved(true);
    setTimeout(() => setTargetsSaved(false), 2000);
  };

  const inputStyle = {
    width: "100%", padding: "11px 14px", borderRadius: 10,
    border: "1.5px solid #CFDCE8", background: "#F7FAFD",
    fontFamily: "system-ui,sans-serif", fontSize: 14, color: "#1A2A38",
    outline: "none", boxSizing: "border-box",
  };

  // ── Goal Card ──
  function GoalCard({ goalKey, val, pct, bars, recentEntries }) {
    const g = GOAL_META[goalKey];
    const done = pct >= 100;
    const [recentState, setRecentState] = useState("closed");
    const shown = recentState === "three" ? recentEntries.slice(0, 3)
                : recentState === "eight" ? recentEntries.slice(0, 8) : [];
    const linkStyle = { fontFamily: "system-ui,sans-serif", fontSize: 12, fontWeight: 700, color: g.color, cursor: "pointer", userSelect: "none", background: "none", border: "none", padding: 0 };

    return (
      <div style={{ background: "#fff", border: `2px solid ${done ? g.color + "55" : "#CFDCE8"}`, borderRadius: 24, padding: "28px 32px", boxShadow: done ? `0 8px 30px ${g.color}1A` : "0 4px 14px rgba(0,0,0,0.05)", position: "relative" }}>
        {done && <div style={{ position:"absolute", top:14, right:16, fontSize:10, fontFamily:"system-ui,sans-serif", fontWeight:800, color:"#fff", background:g.color, padding:"2px 12px", borderRadius:99 }}>GOAL MET ✓</div>}
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <div style={{ position: "relative", display: "inline-block" }}>
              <Ring pct={pct} color={g.color} />
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column" }}>
                <div style={{ fontSize: 22 }}>{g.icon}</div>
                <div style={{ fontFamily:"system-ui,sans-serif", fontWeight:900, fontSize:18, color:g.color, lineHeight:1 }}>{pct}%</div>
              </div>
            </div>
            <div style={{ fontFamily:"system-ui,sans-serif", fontSize:22, fontWeight:900, color:g.color, marginTop:4 }}>
              {val}<span style={{ fontSize:13, color:"#B0BEC9", fontWeight:400 }}> / {targets[goalKey]}</span>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight:800, fontSize:18, color:"#0D2D45", marginBottom:2 }}>{g.label}</div>
            <div style={{ fontFamily:"system-ui,sans-serif", fontSize:12, color:"#9BAAB8", marginBottom:16 }}>
              Goal: {targets[goalKey]} this month · {goalKey === "trips" ? "Monthly view" : "Weekly view"}
            </div>
            <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", marginBottom:8, letterSpacing:1, textTransform:"uppercase" }}>
              {goalKey === "trips" ? "Last 5 Months" : "Last 5 Weeks"}
            </div>
            <HistoryBars bars={bars} color={g.color} bg={g.bg} />
          </div>
        </div>

        {/* Recent section */}
        <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid #EEF4F9" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <button onClick={() => setRecentState(recentState === "closed" ? "three" : "closed")} style={{ ...linkStyle, display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ fontSize:14 }}>{recentState === "closed" ? "▼" : "▲"}</span>
              <span style={{ letterSpacing:1, textTransform:"uppercase", fontSize:11 }}>Recent</span>
            </button>
            {recentEntries.length === 0 && <span style={{ fontFamily:"system-ui,sans-serif", fontSize:12, color:"#C4D0DB", fontStyle:"italic" }}>No entries yet</span>}
          </div>
          {recentState !== "closed" && shown.length > 0 && (
            <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:7 }}>
              {shown.map(e => (
                <div key={e.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:g.color, flexShrink:0 }} />
                  <span style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#3D5A70", flex:1 }}>{e.detail}</span>
                  <span style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#C4D0DB", flexShrink:0 }}>
                    {new Date(e.date + "T00:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric" })}
                  </span>
                </div>
              ))}
              <div style={{ marginTop:6, display:"flex", justifyContent:"space-between" }}>
                {recentState === "three" && recentEntries.length > 3 && (
                  <button onClick={() => setRecentState("eight")} style={{ ...linkStyle }}>Show more ({Math.min(recentEntries.length, 8) - 3} more) ›</button>
                )}
                {recentState === "eight" && (
                  <button onClick={() => setRecentState("closed")} style={{ ...linkStyle }}>▲ Close</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Not configured screen ──
  if (!isConfigured) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(155deg,#F4F9FD,#EBF4FB,#F0EEFF)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", border:"2px solid #CFDCE8", borderRadius:24, padding:"40px 36px", maxWidth:520, textAlign:"center", boxShadow:"0 8px 40px rgba(29,111,164,0.1)" }}>
        <div style={{ fontSize:40, marginBottom:16 }}>🔧</div>
        <h2 style={{ margin:"0 0 12px", color:"#0D2D45", fontSize:22 }}>Setup Required</h2>
        <p style={{ fontFamily:"system-ui,sans-serif", fontSize:14, color:"#6A8EAA", lineHeight:1.7, margin:"0 0 20px" }}>
          Follow the setup instructions to connect this app to your Google Sheet, then paste your Apps Script URL into the <code style={{ background:"#F0F4F8", padding:"2px 6px", borderRadius:4 }}>SHEET_URL</code> constant at the top of the code.
        </p>
        <div style={{ background:"#EBF4FB", borderRadius:12, padding:"14px 18px", fontFamily:"system-ui,sans-serif", fontSize:13, color:"#1D6FA4", fontWeight:600 }}>
          See the setup guide below the artifact panel
        </div>
      </div>
    </div>
  );

  // ── Loading screen ──
  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(155deg,#F4F9FD,#EBF4FB,#F0EEFF)", fontFamily:"system-ui,sans-serif", color:"#6A8EAA", fontSize:15, flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:32 }}>🌍</div>
      Loading your data...
    </div>
  );

  // ── Error screen ──
  if (error) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"linear-gradient(155deg,#F4F9FD,#EBF4FB,#F0EEFF)", padding:20 }}>
      <div style={{ background:"#fff", border:"2px solid #FFCDD2", borderRadius:24, padding:"36px", maxWidth:480, textAlign:"center" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>⚠️</div>
        <div style={{ fontFamily:"system-ui,sans-serif", fontSize:15, color:"#C53030", fontWeight:700, marginBottom:8 }}>Connection Error</div>
        <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#6A8EAA", marginBottom:20 }}>{error}</div>
        <button onClick={loadData} style={{ padding:"10px 24px", borderRadius:99, border:"none", cursor:"pointer", background:"linear-gradient(135deg,#1D6FA4,#5B4FCF)", color:"#fff", fontFamily:"system-ui,sans-serif", fontWeight:700, fontSize:14 }}>
          Try Again
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(155deg,#F4F9FD 0%,#EBF4FB 45%,#F0EEFF 100%)", fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,serif", position:"relative", overflowX:"hidden" }}>
      <div style={{ position:"fixed", top:-120, right:-80, width:420, height:420, borderRadius:"50%", background:"radial-gradient(circle,rgba(29,111,164,0.08),transparent 70%)", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", bottom:-100, left:-60, width:360, height:360, borderRadius:"50%", background:"radial-gradient(circle,rgba(91,79,207,0.07),transparent 70%)", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none", backgroundImage:"radial-gradient(circle,rgba(29,111,164,0.06) 1px,transparent 1px)", backgroundSize:"28px 28px", opacity:0.6 }} />

      {/* Saving indicator */}
      {saving && (
        <div style={{ position:"fixed", bottom:16, right:16, zIndex:9999, background:"#fff", border:"1.5px solid #CFDCE8", borderRadius:99, padding:"8px 18px", fontFamily:"system-ui,sans-serif", fontSize:12, color:"#6A8EAA", boxShadow:"0 4px 16px rgba(0,0,0,0.08)" }}>
          💾 Saving...
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed", top:22, left:"50%", transform:"translateX(-50%)", zIndex:9999, background:"#fff", border:"2px solid #1D6FA4", color:"#0D2D45", padding:"12px 26px", borderRadius:99, fontFamily:"system-ui,sans-serif", fontWeight:700, fontSize:14, boxShadow:"0 8px 36px rgba(29,111,164,0.18)", whiteSpace:"nowrap", animation:"popUp 0.3s cubic-bezier(.4,2,.6,1)" }}>
          {toast}
        </div>
      )}

      <div style={{ position:"relative", zIndex:1, maxWidth:940, margin:"0 auto", padding:"40px 20px 64px" }}>

        {/* HEADER */}
        <div style={{ textAlign:"center", marginBottom:44 }}>
          <div style={{ display:"inline-block", marginBottom:16, background:"linear-gradient(135deg,#1D6FA4,#3B9FD4)", color:"#fff", fontSize:11, letterSpacing:4, fontFamily:"system-ui,sans-serif", fontWeight:700, textTransform:"uppercase", padding:"5px 18px", borderRadius:99 }}>
            ● Live · {monthLabel(cmk)}
          </div>
          <h1 style={{ margin:"0 0 6px", fontSize:"clamp(26px,5vw,50px)", lineHeight:1.05, letterSpacing:"-1px", color:"#0D2D45", fontWeight:900 }}>
            Meet More. Venture Out.{" "}
            <span style={{ background:"linear-gradient(90deg,#1D6FA4,#5B4FCF)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Share Wider.</span>
          </h1>
          <p style={{ color:"#6A8EAA", fontFamily:"system-ui,sans-serif", fontSize:14, margin:"0 0 24px", fontStyle:"italic" }}>
            The more we meet, explore, and share — the more opportunities find us
          </p>
          <div style={{ display:"inline-flex", alignItems:"center", gap:16, background:"#fff", border:"2px solid #CFDCE8", borderRadius:99, padding:"12px 28px", boxShadow:"0 4px 20px rgba(29,111,164,0.1)" }}>
            <span style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#6A8EAA", fontWeight:600 }}>This Month</span>
            <div style={{ background:"#E2EEF7", borderRadius:99, width:130, height:10, overflow:"hidden" }}>
              <div style={{ height:"100%", borderRadius:99, width:overallPct+"%", background:"linear-gradient(90deg,#1D6FA4,#5B4FCF)", transition:"width 1s ease", boxShadow:"0 2px 8px rgba(29,111,164,0.3)" }} />
            </div>
            <span style={{ fontWeight:900, fontSize:22, color:overallPct>=100?"#0B8A72":"#1D6FA4", fontFamily:"system-ui,sans-serif" }}>{overallPct}%</span>
            {overallPct>=100 && <span style={{ fontSize:20 }}>🎉</span>}
          </div>
          <p style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#9BAAB8", marginTop:10, marginBottom:0, fontStyle:"italic" }}>{CHEERS[cheerIdx]}</p>
        </div>

        {/* TABS */}
        <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:40, flexWrap:"wrap" }}>
          {[
            { id:"board",   label:"📋 Scoreboard" },
            { id:"log",     label:"➕ Log a Win" },
            { id:"history", label:"📚 All Records" },
            { id:"manage",  label:"⚙️ Manage Data" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:"10px 22px", borderRadius:99, border:"none", cursor:"pointer",
              fontFamily:"system-ui,sans-serif", fontWeight:700, fontSize:13,
              background: tab===t.id ? "linear-gradient(135deg,#1D6FA4,#5B4FCF)" : "#fff",
              color: tab===t.id ? "#fff" : "#6A8EAA",
              boxShadow: tab===t.id ? "0 4px 18px rgba(29,111,164,0.3)" : "0 2px 8px rgba(0,0,0,0.06)",
              border: tab===t.id ? "none" : "1.5px solid #CFDCE8",
              transition:"all 0.2s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ SCOREBOARD ══ */}
        {tab === "board" && (
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
            <GoalCard goalKey="meetings" val={curMonth.meetings||0} pct={Math.min(100,Math.round(((curMonth.meetings||0)/targets.meetings)*100))} bars={getMeetingsBars()} recentEntries={entries.filter(e=>e.goal==="meetings").sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)} />
            <GoalCard goalKey="trips"    val={curMonth.trips||0}    pct={Math.min(100,Math.round(((curMonth.trips||0)/targets.trips)*100))}       bars={getTripsBars()}    recentEntries={entries.filter(e=>e.goal==="trips").sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)} />
            <GoalCard goalKey="outreach" val={curMonth.outreach||0} pct={Math.min(100,Math.round(((curMonth.outreach||0)/targets.outreach)*100))} bars={getOutreachBars()} recentEntries={entries.filter(e=>e.goal==="outreach").sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)} />
            <div style={{ background:"linear-gradient(135deg,#EBF4FB,#F0EEFF)", border:"2px dashed #9BC8E8", borderRadius:20, padding:"18px 24px", textAlign:"center", display:"flex", alignItems:"center", justifyContent:"center", gap:12 }}>
              <span style={{ fontSize:22 }}>🌍</span>
              <div>
                <div style={{ fontWeight:800, fontSize:15, color:"#0D2D45", marginBottom:3 }}>Every action compounds. Keep showing up!</div>
                <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#6A8EAA" }}>Your meetings, travels, and outreaches are building something bigger than you can see right now. 🚀</div>
              </div>
              <span style={{ fontSize:22 }}>✨</span>
            </div>
          </div>
        )}

        {/* ══ LOG A WIN ══ */}
        {tab === "log" && (
          <div style={{ maxWidth:520, margin:"0 auto" }}>
            <div style={{ background:"#fff", border:"2px solid #CFDCE8", borderRadius:28, padding:34, boxShadow:"0 8px 36px rgba(29,111,164,0.09)" }}>
              <div style={{ textAlign:"center", marginBottom:28 }}>
                <div style={{ fontSize:38, marginBottom:8 }}>🎉</div>
                <h2 style={{ margin:0, fontSize:22, color:"#0D2D45" }}>Log a Win</h2>
                <p style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#6A8EAA", margin:"6px 0 0" }}>Log past activities too — just pick the right date.</p>
              </div>
              <div style={{ marginBottom:22 }}>
                <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", marginBottom:8, letterSpacing:1, textTransform:"uppercase", fontWeight:700 }}>Date of Activity</div>
                <input type="date" value={logDate} max={todayStr()} onChange={e=>setLogDate(e.target.value)} style={{ ...inputStyle, cursor:"pointer" }} />
              </div>
              <div style={{ marginBottom:22 }}>
                <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", marginBottom:8, letterSpacing:1, textTransform:"uppercase", fontWeight:700 }}>What happened?</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {Object.entries(GOAL_META).map(([key,g]) => {
                    const sel = logGoal===key;
                    return (
                      <div key={key} onClick={()=>{ setLogGoal(key); setLogDetail({who:"",where:"",whom:"",about:""}); }} style={{ padding:"13px 16px", borderRadius:14, cursor:"pointer", border:sel?`2.5px solid ${g.color}`:"2px solid #CFDCE8", background:sel?g.bg:"#FAFBFC", display:"flex", alignItems:"center", gap:12, transition:"all 0.15s", boxShadow:sel?`0 3px 12px ${g.color}22`:"none" }}>
                        <span style={{ fontSize:22 }}>{g.icon}</span>
                        <div style={{ fontWeight:700, fontFamily:"system-ui,sans-serif", fontSize:14, color:sel?g.color:"#3D5A70" }}>{g.label}</div>
                        {sel && <div style={{ marginLeft:"auto", color:g.color, fontWeight:800 }}>✓</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
              {logGoal==="meetings" && (
                <div style={{ marginBottom:22 }}>
                  <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", letterSpacing:1, textTransform:"uppercase", fontWeight:700, marginBottom:8 }}>Who did you meet?</div>
                  <input value={logDetail.who} onChange={e=>setLogDetail(d=>({...d,who:e.target.value}))} placeholder="e.g. Sarah Chen at a fintech conference…" style={inputStyle} />
                </div>
              )}
              {logGoal==="trips" && (
                <div style={{ marginBottom:22 }}>
                  <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", letterSpacing:1, textTransform:"uppercase", fontWeight:700, marginBottom:8 }}>Where did you travel?</div>
                  <input value={logDetail.where} onChange={e=>setLogDetail(d=>({...d,where:e.target.value}))} placeholder="e.g. Tokyo, London, Dubai…" style={inputStyle} />
                </div>
              )}
              {logGoal==="outreach" && (
                <div style={{ marginBottom:22, display:"flex", flexDirection:"column", gap:12 }}>
                  <div>
                    <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", letterSpacing:1, textTransform:"uppercase", fontWeight:700, marginBottom:8 }}>To whom?</div>
                    <input value={logDetail.whom} onChange={e=>setLogDetail(d=>({...d,whom:e.target.value}))} placeholder="e.g. John at TechStart…" style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", letterSpacing:1, textTransform:"uppercase", fontWeight:700, marginBottom:8 }}>About what?</div>
                    <input value={logDetail.about} onChange={e=>setLogDetail(d=>({...d,about:e.target.value}))} placeholder="e.g. our advisory services…" style={inputStyle} />
                  </div>
                </div>
              )}
              <button onClick={submitLog} disabled={!canSubmit()} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", cursor:canSubmit()?"pointer":"not-allowed", background:canSubmit()?"linear-gradient(135deg,#1D6FA4,#5B4FCF)":"#EEF4F9", color:canSubmit()?"#fff":"#9BAAB8", fontFamily:"system-ui,sans-serif", fontWeight:800, fontSize:16, boxShadow:canSubmit()?"0 6px 22px rgba(29,111,164,0.32)":"none", transition:"all 0.2s" }}>
                🚀 Add to Our Score!
              </button>
            </div>
            {entries.length > 0 && (
              <div style={{ marginTop:24 }}>
                <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8", letterSpacing:1, textTransform:"uppercase", fontWeight:700, marginBottom:12 }}>Recent Wins 🎯</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {entries.slice(0,6).map(e => {
                    const g = GOAL_META[e.goal];
                    return (
                      <div key={e.id} style={{ background:"#fff", border:"1.5px solid #CFDCE8", borderRadius:12, padding:"11px 16px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px rgba(0,0,0,0.04)" }}>
                        <span style={{ fontSize:18 }}>{g.icon}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#0D2D45", fontWeight:600 }}>{e.detail}</div>
                          <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#9BAAB8" }}>{g.label} · {new Date(e.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ ALL RECORDS ══ */}
        {tab === "history" && (
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
            <div style={{ background:"#fff", border:"2px solid #CFDCE8", borderRadius:24, padding:"28px", boxShadow:"0 4px 14px rgba(0,0,0,0.05)" }}>
              <div style={{ fontWeight:800, fontSize:17, color:"#0D2D45", marginBottom:4 }}>📅 Monthly Summary</div>
              <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#9BAAB8", marginBottom:20 }}>All-time totals — auto-calculated from your logs</div>
              {allMonthsSorted().length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", fontFamily:"system-ui,sans-serif", color:"#C4D0DB", fontSize:14 }}>No data yet. Start logging your wins! 🚀</div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"system-ui,sans-serif", fontSize:13 }}>
                    <thead>
                      <tr>{["Month","🤝 Meet","✈️ Travel","🗣️ Reach Out","Progress"].map(h => (
                        <th key={h} style={{ textAlign:"left", padding:"8px 12px", color:"#9BAAB8", fontWeight:700, fontSize:11, letterSpacing:1, textTransform:"uppercase", borderBottom:"2px solid #EEF4F9" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {allMonthsSorted().map(row => {
                        const isCurrent = row.key === cmk;
                        const pct = Math.round((Math.min(100,(row.meetings/targets.meetings)*100)+Math.min(100,(row.trips/targets.trips)*100)+Math.min(100,(row.outreach/targets.outreach)*100))/3);
                        return (
                          <tr key={row.key} style={{ background:isCurrent?"#F4F9FD":"#fff" }}>
                            <td style={{ padding:"10px 12px", fontWeight:isCurrent?800:600, color:isCurrent?"#1D6FA4":"#3D5A70", borderBottom:"1px solid #EEF4F9" }}>
                              {row.label} {isCurrent && <span style={{ fontSize:10, background:"#1D6FA4", color:"#fff", padding:"1px 7px", borderRadius:99, marginLeft:6 }}>NOW</span>}
                            </td>
                            <td style={{ padding:"10px 12px", color:GOAL_META.meetings.color, fontWeight:700, borderBottom:"1px solid #EEF4F9" }}>{row.meetings}<span style={{ color:"#C4D0DB", fontWeight:400 }}>/{targets.meetings}</span></td>
                            <td style={{ padding:"10px 12px", color:GOAL_META.trips.color, fontWeight:700, borderBottom:"1px solid #EEF4F9" }}>{row.trips}<span style={{ color:"#C4D0DB", fontWeight:400 }}>/{targets.trips}</span></td>
                            <td style={{ padding:"10px 12px", color:GOAL_META.outreach.color, fontWeight:700, borderBottom:"1px solid #EEF4F9" }}>{row.outreach}<span style={{ color:"#C4D0DB", fontWeight:400 }}>/{targets.outreach}</span></td>
                            <td style={{ padding:"10px 12px", borderBottom:"1px solid #EEF4F9" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                <div style={{ flex:1, background:"#EEF4F9", borderRadius:99, height:7, overflow:"hidden" }}>
                                  <div style={{ width:pct+"%", height:"100%", borderRadius:99, background:"linear-gradient(90deg,#1D6FA4,#5B4FCF)" }} />
                                </div>
                                <span style={{ fontWeight:700, color:pct>=100?"#0B8A72":"#6A8EAA", minWidth:36, textAlign:"right" }}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{ background:"#fff", border:"2px solid #CFDCE8", borderRadius:24, padding:"28px", boxShadow:"0 4px 14px rgba(0,0,0,0.05)" }}>
              <div style={{ fontWeight:800, fontSize:17, color:"#0D2D45", marginBottom:4 }}>📋 Full Activity Log</div>
              <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#9BAAB8", marginBottom:20 }}>Every logged entry, sorted by most recent activity date</div>
              <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
                {Object.entries(GOAL_META).map(([key,g]) => (
                  <button key={key} onClick={()=>setHistGoal(key)} style={{ padding:"7px 18px", borderRadius:99, border:"none", cursor:"pointer", fontFamily:"system-ui,sans-serif", fontWeight:700, fontSize:12, background:histGoal===key?g.color:"#F2F7FB", color:histGoal===key?"#fff":"#6A8EAA", transition:"all 0.15s", boxShadow:histGoal===key?`0 3px 12px ${g.color}44`:"none" }}>
                    {g.icon} {g.label}
                  </button>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {entries.filter(e=>e.goal===histGoal).sort((a,b)=>b.date.localeCompare(a.date)).length === 0 ? (
                  <div style={{ textAlign:"center", padding:"32px 0", fontFamily:"system-ui,sans-serif", color:"#C4D0DB", fontSize:14 }}>No entries yet for this category.</div>
                ) : entries.filter(e=>e.goal===histGoal).sort((a,b)=>b.date.localeCompare(a.date)).map(e => (
                  <div key={e.id} style={{ background:"#F7FAFD", border:"1.5px solid #E2EEF5", borderRadius:12, padding:"12px 16px", display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:GOAL_META[e.goal].color, flexShrink:0 }} />
                    <div style={{ flex:1, fontFamily:"system-ui,sans-serif", fontSize:14, color:"#0D2D45", fontWeight:600 }}>{e.detail}</div>
                    <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#B0BEC9", flexShrink:0 }}>
                      {new Date(e.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══ MANAGE DATA ══ */}
        {tab === "manage" && (
          <div style={{ display:"flex", flexDirection:"column", gap:20, maxWidth:640, margin:"0 auto" }}>
            <div style={{ background:"#fff", border:"2px solid #CFDCE8", borderRadius:24, padding:"28px", boxShadow:"0 4px 14px rgba(0,0,0,0.05)" }}>
              <div style={{ fontWeight:800, fontSize:17, color:"#0D2D45", marginBottom:4 }}>🎯 Monthly Targets</div>
              <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#9BAAB8", marginBottom:24 }}>One target applies to all months. Change anytime.</div>
              <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
                {Object.entries(GOAL_META).map(([key,g]) => (
                  <div key={key} style={{ display:"flex", alignItems:"center", gap:16 }}>
                    <div style={{ width:36, textAlign:"center", fontSize:22 }}>{g.icon}</div>
                    <div style={{ flex:1, fontFamily:"system-ui,sans-serif", fontWeight:700, fontSize:15, color:"#0D2D45" }}>{g.label}</div>
                    <input type="number" min="1" value={editTargets[key]} onChange={e=>setEditTargets(t=>({...t,[key]:e.target.value}))} style={{ ...inputStyle, width:90, textAlign:"center", fontWeight:800, fontSize:17, color:g.color }} />
                    <span style={{ fontFamily:"system-ui,sans-serif", fontSize:12, color:"#9BAAB8", width:60 }}>per month</span>
                  </div>
                ))}
              </div>
              <button onClick={saveTargets} style={{ marginTop:24, width:"100%", padding:"13px", borderRadius:12, border:"none", cursor:"pointer", background:"linear-gradient(135deg,#1D6FA4,#5B4FCF)", color:"#fff", fontFamily:"system-ui,sans-serif", fontWeight:800, fontSize:15, boxShadow:"0 4px 18px rgba(29,111,164,0.28)", transition:"all 0.2s" }}>
                {targetsSaved ? "✅ Targets Saved!" : "Save Targets"}
              </button>
            </div>
            <div style={{ background:"#fff", border:"2px solid #CFDCE8", borderRadius:24, padding:"28px", boxShadow:"0 4px 14px rgba(0,0,0,0.05)" }}>
              <div style={{ fontWeight:800, fontSize:17, color:"#0D2D45", marginBottom:4 }}>📋 Edit Activity Log</div>
              <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#9BAAB8", marginBottom:20 }}>
                Delete any entry. To correct: delete the wrong one, then log a new correct one in ➕ tab.
              </div>
              {entries.length === 0 ? (
                <div style={{ textAlign:"center", padding:"32px 0", fontFamily:"system-ui,sans-serif", color:"#C4D0DB", fontSize:14 }}>No entries yet.</div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:420, overflowY:"auto" }}>
                  {entries.sort((a,b)=>b.date.localeCompare(a.date)).map(e => {
                    const g = GOAL_META[e.goal];
                    return (
                      <div key={e.id} style={{ background:"#F7FAFD", border:"1.5px solid #E2EEF5", borderRadius:12, padding:"11px 14px", display:"flex", alignItems:"center", gap:12 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>{g.icon}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ fontFamily:"system-ui,sans-serif", fontSize:13, color:"#0D2D45", fontWeight:600 }}>{e.detail}</div>
                          <div style={{ fontFamily:"system-ui,sans-serif", fontSize:11, color:"#B0BEC9" }}>{g.label} · {new Date(e.date+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                        </div>
                        <button onClick={()=>deleteEntry(e.id)} style={{ padding:"5px 12px", borderRadius:8, border:"1.5px solid #FFCDD2", background:"#FFF5F5", color:"#E53E3E", fontFamily:"system-ui,sans-serif", fontWeight:700, fontSize:12, cursor:"pointer", flexShrink:0 }}>
                          🗑 Delete
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ textAlign:"center", marginTop:52, fontFamily:"system-ui,sans-serif", fontSize:11, color:"#C4D4E0" }}>
          Meet More. Venture Out. Share Wider. · Powered by Google Sheets 📊
        </div>
      </div>
      <style>{`
        @keyframes popUp {
          from { transform:translateX(-50%) translateY(-8px) scale(0.9); opacity:0; }
          to   { transform:translateX(-50%) translateY(0) scale(1); opacity:1; }
        }
        * { box-sizing:border-box; }
        input::placeholder { color:#C4D0DB; }
        input[type=date]::-webkit-calendar-picker-indicator { opacity:0.5; cursor:pointer; }
      `}</style>
    </div>
  );
}
