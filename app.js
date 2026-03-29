const SNAPSHOT_KEY = "spx_drawdown_v1";
const CRISIS_KEY = "spx_crisis_drawdowns_v1";

const ui = {
  refreshBtn: document.getElementById("refreshBtn"),
  installBtn: document.getElementById("installBtn"),
  status: document.getElementById("status"),
  crisisList: document.getElementById("crisisList"),
  dropPct: document.getElementById("dropPct"),
  dropPts: document.getElementById("dropPts"),
  currentVal: document.getElementById("currentVal"),
  athVal: document.getElementById("athVal"),
  asofVal: document.getElementById("asofVal"),
  updatedVal: document.getElementById("updatedVal"),
  gauge: {
    arc: document.getElementById("gaugeArc"),
    value: document.getElementById("gaugeValue"),
    maxLabel: document.getElementById("gaugeMaxLabel"),
    needle: document.getElementById("gaugeNeedle"),
    marks: document.getElementById("crisisMarks"),
  },
};

const fmt = {
  number(value, digits = 2) {
    if (!Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  },
  percent(value, digits = 2) {
    if (!Number.isFinite(value)) return "--%";
    return `${fmt.number(value, digits)}%`;
  },
  drawdownPercent(value, digits = 2) {
    if (!Number.isFinite(value)) return "--%";
    const abs = Math.abs(value);
    if (abs < 1e-9) return `${fmt.number(0, digits)}%`;
    return `-${fmt.number(abs, digits)}%`;
  },
  dt(value) {
    try {
      return new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    } catch {
      return "--";
    }
  },
};

const CRISES = [
  { id: "black_monday_1987", name: "1987 블랙 먼데이", start: "1987-01-01", end: "1988-12-31" },
  { id: "dotcom_2000", name: "2000 닷컴 버블 붕괴", start: "2000-01-01", end: "2003-12-31" },
  { id: "gfc_2008", name: "2008 글로벌 금융위기", start: "2007-01-01", end: "2009-12-31" },
  { id: "covid_2020", name: "2020 코로나 쇼크", start: "2019-10-01", end: "2020-12-31" },
  { id: "inflation_2022", name: "2022 인플레이션·금리 급등", start: "2021-10-01", end: "2022-12-31" },
];

const CRISIS_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#fb7185", "#a78bfa"];
const CRISIS_COLOR_BY_ID = new Map(CRISES.map((c, i) => [c.id, CRISIS_COLORS[i % CRISIS_COLORS.length]]));

function setStatus(message) {
  ui.status.textContent = message ?? "";
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function renderGauge({ dropPct }) {
  const max = 100;
  ui.gauge.maxLabel.textContent = "100%";

  const normalized = clamp((dropPct ?? 0) / max, 0, 1);
  const arcLen = ui.gauge.arc.getTotalLength();
  ui.gauge.arc.style.strokeDasharray = `${arcLen}`;
  ui.gauge.arc.style.strokeDashoffset = `${arcLen * (1 - normalized)}`;

  const deg = -90 + normalized * 180;
  ui.gauge.needle.setAttribute("transform", `translate(160 160) rotate(${deg})`);
  ui.gauge.value.textContent = fmt.drawdownPercent(dropPct, 2);
}

function setCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function getCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonText(maybeWrappedText) {
  const s = String(maybeWrappedText ?? "").trim();
  if (!s) throw new Error("응답이 비어 있습니다.");
  if (s.startsWith("{") || s.startsWith("[")) return s;

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return s.slice(first, last + 1);
  return s;
}

const ymdFormatterCache = new Map();
function formatYmdInTimeZone(ms, timeZone) {
  try {
    const tz = timeZone || "UTC";
    let dtf = ymdFormatterCache.get(tz);
    if (!dtf) {
      dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
      ymdFormatterCache.set(tz, dtf);
    }
    const parts = dtf.formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === "year")?.value ?? "0000";
    const m = parts.find((p) => p.type === "month")?.value ?? "00";
    const d = parts.find((p) => p.type === "day")?.value ?? "00";
    return `${y}-${m}-${d}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function ymdFromUnixSeconds(sec, timeZone) {
  if (!Number.isFinite(sec)) return "--";
  return formatYmdInTimeZone(sec * 1000, timeZone);
}

function ymdToUnixSeconds(ymd, { endOfDay = false } = {}) {
  const t = endOfDay ? `${ymd}T23:59:59Z` : `${ymd}T00:00:00Z`;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) throw new Error(`날짜 파싱 실패: ${ymd}`);
  return Math.floor(ms / 1000);
}

function pointHigh(p) {
  if (Number.isFinite(p.high)) return p.high;
  if (Number.isFinite(p.close)) return p.close;
  return -Infinity;
}

function pointLow(p) {
  if (Number.isFinite(p.low)) return p.low;
  if (Number.isFinite(p.close)) return p.close;
  return Infinity;
}

function parseYahooChartSeries(text) {
  const raw = extractJsonText(text);
  const json = JSON.parse(raw);

  const error = json?.chart?.error;
  if (error) throw new Error(`Yahoo Finance 오류: ${error.description || error.code || "unknown"}`);

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo Finance 차트 데이터가 비어 있습니다.");

  const timeZone = result?.meta?.exchangeTimezoneName || "America/New_York";

  const timestamps = result.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];

  if (!Array.isArray(timestamps) || timestamps.length === 0) {
    throw new Error("Yahoo Finance 데이터 포맷이 예상과 다릅니다.");
  }

  const points = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    if (!Number.isFinite(ts)) continue;
    const close = closes[i];
    const high = highs[i];
    const low = lows[i];
    if (![close, high, low].some((v) => Number.isFinite(v))) continue;
    points.push({ ts, date: ymdFromUnixSeconds(ts, timeZone), close, high, low });
  }

  if (points.length === 0) throw new Error("유효한 가격 데이터를 찾지 못했습니다.");

  const metaPrice = result?.meta?.regularMarketPrice;
  const metaDayHigh = result?.meta?.regularMarketDayHigh;
  const metaTime = result?.meta?.regularMarketTime;
  const currentFromMeta =
    Number.isFinite(metaPrice) && Number.isFinite(metaTime)
      ? {
          price: metaPrice,
          dayHigh: Number.isFinite(metaDayHigh) ? metaDayHigh : null,
          date: ymdFromUnixSeconds(metaTime, timeZone),
        }
      : null;

  return { points, currentFromMeta };
}

function computeAthAndCurrent(points, currentFromMeta) {
  let last = points[points.length - 1];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (Number.isFinite(p.close) || Number.isFinite(p.high)) {
      last = p;
      break;
    }
  }

  let ath = points[0];
  for (const p of points) {
    if (pointHigh(p) > pointHigh(ath)) ath = p;
  }

  const currentPrice = currentFromMeta?.price ?? (Number.isFinite(last.close) ? last.close : last.high);
  const currentDate = currentFromMeta?.date ?? last.date;

  const seriesAthClose = pointHigh(ath);
  let athClose = seriesAthClose;
  let athDate = ath.date;
  const metaDayHigh = currentFromMeta?.dayHigh;
  if (Number.isFinite(metaDayHigh) && metaDayHigh > seriesAthClose) {
    athClose = metaDayHigh;
    athDate = currentDate;
  }

  return {
    current: { close: currentPrice, date: currentDate },
    ath: { close: athClose, date: athDate },
  };
}

function computeDrawdown({ current, ath }) {
  const dropPts = ath.close - current.close;
  const dropPct = (dropPts / ath.close) * 100;
  return { dropPct, dropPts };
}

function computeMaxDrawdown(points) {
  let peak = points[0];
  let peakHigh = pointHigh(peak);
  let peakAtMax = peak;
  let trough = points[0];
  let maxDd = 0;

  for (const p of points) {
    const pHigh = pointHigh(p);
    if (pHigh > peakHigh) {
      peak = p;
      peakHigh = pHigh;
      continue;
    }

    const pLow = pointLow(p);
    if (!Number.isFinite(pLow) || !Number.isFinite(peakHigh) || peakHigh <= 0) continue;

    const dd = ((peakHigh - pLow) / peakHigh) * 100;
    if (dd > maxDd) {
      maxDd = dd;
      peakAtMax = peak;
      trough = p;
    }
  }

  return { dropPct: maxDd, peak: peakAtMax, trough };
}

async function fetchText(url, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json,text/plain,*/*" },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadGlobal() {
  const chart =
    "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=max&interval=1d&includeAdjustedClose=true";
  const chartAlt =
    "https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=max&interval=1d&includeAdjustedClose=true";

  const jina = `https://r.jina.ai/http://${chart.replace(/^https?:\/\//, "")}`;
  const jinaAlt = `https://r.jina.ai/http://${chartAlt.replace(/^https?:\/\//, "")}`;

  const candidates = [chart, chartAlt, jina, jinaAlt];
  let lastErr;
  for (const url of candidates) {
    try {
      const text = await fetchText(url);
      const { points, currentFromMeta } = parseYahooChartSeries(text);
      const parsed = computeAthAndCurrent(points, currentFromMeta);
      return { source: url, ...parsed };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("데이터를 불러오지 못했습니다.");
}

async function loadCrisis(crisis) {
  const period1 = ymdToUnixSeconds(crisis.start);
  const period2 = ymdToUnixSeconds(crisis.end, { endOfDay: true });

  const base = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&includeAdjustedClose=true&period1=${period1}&period2=${period2}`;
  const alt = `https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&includeAdjustedClose=true&period1=${period1}&period2=${period2}`;
  const jina = `https://r.jina.ai/http://${base.replace(/^https?:\/\//, "")}`;
  const jinaAlt = `https://r.jina.ai/http://${alt.replace(/^https?:\/\//, "")}`;

  const candidates = [base, alt, jina, jinaAlt];
  let lastErr;
  for (const url of candidates) {
    try {
      const text = await fetchText(url, { timeoutMs: 15000 });
      const { points } = parseYahooChartSeries(text);
      const dd = computeMaxDrawdown(points);
      return {
        ...crisis,
        source: url,
        dropPct: dd.dropPct,
        peak: { date: dd.peak.date, close: pointHigh(dd.peak) },
        trough: { date: dd.trough.date, close: pointLow(dd.trough) },
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`위기 데이터 로드 실패: ${crisis.id}`);
}

function crisisColorForId(id) {
  return CRISIS_COLOR_BY_ID.get(id) ?? "#ffffff";
}

function parseYmdMs(ymd) {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function renderCrisisList(items) {
  if (!ui.crisisList) return;

  if (!items) {
    ui.crisisList.innerHTML = `<div class="muted">불러오는 중…</div>`;
    return;
  }

  if (items.length === 0) {
    ui.crisisList.innerHTML = `<div class="muted">표시할 항목이 없습니다.</div>`;
    return;
  }

  const sorted = [...items].sort((a, b) => {
    const aPctKey = Math.round((a.dropPct ?? 0) * 100);
    const bPctKey = Math.round((b.dropPct ?? 0) * 100);
    const d = bPctKey - aPctKey;
    if (d !== 0) return d;
    return parseYmdMs(b.trough?.date) - parseYmdMs(a.trough?.date);
  });

  ui.crisisList.innerHTML = sorted
    .map((c) => {
      const color = crisisColorForId(c.id);
      const pct = fmt.drawdownPercent(c.dropPct, 2);
      const meta = c.peak?.date && c.trough?.date ? `${c.peak.date} → ${c.trough.date}` : `${c.start} → ${c.end}`;
      return `
        <div class="crisisItem">
          <div class="crisisDot" style="background:${color}"></div>
          <div class="crisisName">${c.name}</div>
          <div class="crisisPct">${pct}</div>
          <div class="crisisMeta">${meta}</div>
        </div>
      `;
    })
    .join("");
}

function clearSvgChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function crisisTieReducedForMarks(items) {
  const map = new Map();
  for (const c of items) {
    if (!Number.isFinite(c.dropPct)) continue;
    const key = (Math.round(c.dropPct * 100) / 100).toFixed(2);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, c);
      continue;
    }
    const prevMs = parseYmdMs(prev.trough?.date);
    const curMs = parseYmdMs(c.trough?.date);
    if (curMs >= prevMs) map.set(key, c);
  }
  return [...map.values()];
}

function renderCrisisMarks(items) {
  if (!ui.gauge.marks) return;
  clearSvgChildren(ui.gauge.marks);
  if (!items || items.length === 0) return;

  const reduced = crisisTieReducedForMarks(items);
  const NS = "http://www.w3.org/2000/svg";
  const r = 120;

  reduced.forEach((c) => {
    const normalized = clamp((c.dropPct ?? 0) / 100, 0, 1);
    const deg = -90 + normalized * 180;
    const rad = (deg * Math.PI) / 180;
    const x = 160 + r * Math.sin(rad);
    const y = 160 - r * Math.cos(rad);

    const color = crisisColorForId(c.id);

    const ring = document.createElementNS(NS, "circle");
    ring.setAttribute("class", "markRing");
    ring.setAttribute("cx", String(x));
    ring.setAttribute("cy", String(y));
    ring.setAttribute("r", "7");

    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "markDot");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", color);

    const title = document.createElementNS(NS, "title");
    title.textContent = c.name;
    ring.appendChild(title.cloneNode(true));
    dot.appendChild(title);

    ui.gauge.marks.appendChild(ring);
    ui.gauge.marks.appendChild(dot);
  });
}

function renderSnapshot(snapshot, { fromCache } = { fromCache: false }) {
  const { current, ath, computed, updatedAt, source } = snapshot;

  ui.dropPct.textContent = fmt.drawdownPercent(computed.dropPct, 2);
  ui.dropPts.textContent = `${fmt.number(computed.dropPts, 2)} pt`;
  ui.currentVal.textContent = `${fmt.number(current.close, 2)} (${current.date})`;
  ui.athVal.textContent = `${fmt.number(ath.close, 2)} (${ath.date})`;
  ui.asofVal.textContent = current.date;
  ui.updatedVal.textContent = `${fmt.dt(updatedAt)}${fromCache ? " (캐시)" : ""}`;

  renderGauge({ dropPct: computed.dropPct });
  setStatus(source ? `소스: ${source}` : "");
}

function setupInstallPrompt() {
  let deferred = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    ui.installBtn.hidden = false;
  });

  ui.installBtn.addEventListener("click", async () => {
    if (!deferred) return;
    ui.installBtn.hidden = true;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } finally {
      deferred = null;
    }
  });
}

async function refreshSnapshot() {
  setStatus("데이터 불러오는 중…");
  ui.refreshBtn.disabled = true;

  try {
    const data = await loadGlobal();
    const computed = computeDrawdown(data);
    const snapshot = {
      current: data.current,
      ath: data.ath,
      computed,
      source: data.source,
      updatedAt: Date.now(),
    };
    setCache(SNAPSHOT_KEY, snapshot);
    renderSnapshot(snapshot, { fromCache: false });
    setStatus("");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`실패: ${msg}`);
  } finally {
    ui.refreshBtn.disabled = false;
  }
}

async function refreshCrises() {
  renderCrisisList(null);

  const cached = getCache(CRISIS_KEY);
  const maxAgeMs = 1000 * 60 * 60 * 24 * 14;
  if (cached?.items?.length && Date.now() - (cached.updatedAt ?? 0) < maxAgeMs) {
    renderCrisisList(cached.items);
    renderCrisisMarks(cached.items);
    return;
  }

  if (cached?.items?.length) {
    renderCrisisList(cached.items);
    renderCrisisMarks(cached.items);
  }

  try {
    const items = await Promise.all(CRISES.map((c) => loadCrisis(c)));
    const payload = { updatedAt: Date.now(), items };
    setCache(CRISIS_KEY, payload);
    renderCrisisList(items);
    renderCrisisMarks(items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!cached?.items?.length) {
      ui.crisisList.innerHTML = `<div class="muted">불러오기 실패: ${msg}</div>`;
    }
  }
}

async function init() {
  setupInstallPrompt();

  if ("serviceWorker" in navigator) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => reg.update?.())
      .catch(() => {});
  }

  const cached = getCache(SNAPSHOT_KEY);
  if (cached?.computed?.dropPct != null) {
    renderSnapshot(cached, { fromCache: true });
  } else {
    renderGauge({ dropPct: 0 });
  }

  ui.refreshBtn.addEventListener("click", async () => {
    await refreshSnapshot();
  });

  await Promise.all([refreshSnapshot(), refreshCrises()]);
}

init();
