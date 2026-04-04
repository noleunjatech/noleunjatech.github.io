const SNAPSHOT_KEY = "spx_drawdown_v1";
const CRISIS_KEY = "spx_crisis_drawdowns_v1";
const FNG_KEY = "cnn_fng_v1";
const ETF_KEY = "spx_etf_quotes_v1";
const ETF_RL_UNTIL_KEY = "spx_etf_rl_until_v1";

const AUTO_REFRESH_MAX_AGE_MS = 1000 * 60 * 10;

const ui = {
  refreshBtn: document.getElementById("refreshBtn"),
  installBtn: document.getElementById("installBtn"),
  status: document.getElementById("status"),

  avg10yBadge: document.getElementById("avg10yBadge"),
  etfList: document.getElementById("etfList"),
  etfStatus: document.getElementById("etfStatus"),
  dropPct: document.getElementById("dropPct"),
  dropPts: document.getElementById("dropPts"),
  currentVal: document.getElementById("currentVal"),
  athVal: document.getElementById("athVal"),
  asofVal: document.getElementById("asofVal"),
  updatedVal: document.getElementById("updatedVal"),
  crisisList: document.getElementById("crisisList"),

  spxGauge: {
    arc: document.getElementById("spxGaugeArc"),
    value: document.getElementById("spxGaugeValue"),
    needle: document.getElementById("spxGaugeNeedle"),
    marks: document.getElementById("crisisMarks"),
  },

  fngGauge: {
    arc: document.getElementById("fngGaugeArc"),
    value: document.getElementById("fngGaugeValue"),
    label: document.getElementById("fngGaugeLabel"),
    needle: document.getElementById("fngGaugeNeedle"),
  },
  fngScoreKpi: document.getElementById("fngScoreKpi"),
  fngRatingKpi: document.getElementById("fngRatingKpi"),
  fngScoreRow: document.getElementById("fngScoreRow"),
  fngRatingRow: document.getElementById("fngRatingRow"),
  fngAsOfRow: document.getElementById("fngAsOfRow"),
  fngUpdatedRow: document.getElementById("fngUpdatedRow"),
};

const fmt = {
  number(value, digits = 2) {
    if (!Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
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
  drawdownPercent(value, digits = 2) {
    if (!Number.isFinite(value)) return "--%";
    const abs = Math.abs(value);
    if (abs < 1e-9) return `${fmt.number(0, digits)}%`;
    return `-${fmt.number(abs, digits)}%`;
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

const ETFS = [
  { symbol: "SPY", label: "SPY" },
  { symbol: "VOO", label: "VOO" },
  { symbol: "SPYM", label: "SPYM" },
  { symbol: "379800.KS", label: "KODEX 미국S&P500" },
  { symbol: "360750.KS", label: "TIGER 미국S&P500" },
  { symbol: "360200.KS", label: "ACE 미국S&P500" },
];

const ETF_LABEL_BY_SYMBOL = new Map(ETFS.map((e) => [String(e.symbol).toUpperCase(), e.label]));
const ETF_GOOGLE_FINANCE_ID_BY_SYMBOL = new Map([
  ["SPY", "SPY:NYSEARCA"],
  ["VOO", "VOO:NYSEARCA"],
  ["SPYM", "SPYM:NYSEARCA"],
  ["379800.KS", "379800:KRX"],
  ["360750.KS", "360750:KRX"],
  ["360200.KS", "360200:KRX"],
]);

function setStatus(message) {
  ui.status.textContent = message ?? "";
}

function setEtfStatus(message) {
  if (!ui.etfStatus) return;
  ui.etfStatus.textContent = message ?? "";
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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

function isCacheFresh(key, maxAgeMs, { validate } = {}) {
  const cached = getCache(key);
  const updatedAt = cached?.updatedAt;
  if (!Number.isFinite(updatedAt)) return false;
  if (typeof validate === "function" && !validate(cached)) return false;
  return Date.now() - updatedAt < maxAgeMs;
}

function requiredEtfSymbolsSet() {
  return new Set(ETFS.map((e) => String(e.symbol).toUpperCase()));
}

function etfSnapshotHasAllSymbols(snapshot) {
  const req = requiredEtfSymbolsSet();
  const symbols = Array.isArray(snapshot?.symbols) ? snapshot.symbols : snapshot?.items?.map((i) => i?.symbol);
  if (!Array.isArray(symbols) || symbols.length === 0) return false;
  for (const s of symbols) req.delete(String(s ?? "").toUpperCase());
  return req.size === 0;
}

function signClass(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-12) return "isFlat";
  return value > 0 ? "isUp" : "isDown";
}

function fmtSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${fmt.number(Math.abs(value), digits)}`;
}

function fmtSignedPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return "--%";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${fmt.number(Math.abs(value), digits)}%`;
}

function googleFinanceUrlForEtfSymbol(symbol) {
  const sym = String(symbol || "").toUpperCase();
  const id = ETF_GOOGLE_FINANCE_ID_BY_SYMBOL.get(sym);
  if (id) return `https://www.google.com/finance/quote/${encodeURIComponent(id)}?hl=ko`;

  // Best-effort fallback:
  // - US ETFs usually on NYSEARCA
  // - Korean ETFs use numeric code on KRX
  const ks = sym.endsWith(".KS") ? sym.slice(0, -3) : null;
  if (ks && /^\d+$/.test(ks)) return `https://www.google.com/finance/quote/${encodeURIComponent(`${ks}:KRX`)}?hl=ko`;
  if (sym) return `https://www.google.com/finance/quote/${encodeURIComponent(`${sym}:NYSEARCA`)}?hl=ko`;

  return "https://www.google.com/finance/?hl=ko";
}

function renderArc(arcEl, normalized) {
  if (!arcEl) return;
  const n = clamp(normalized, 0, 1);
  const arcLen = arcEl.getTotalLength();
  arcEl.style.strokeDasharray = `${arcLen}`;
  arcEl.style.strokeDashoffset = `${arcLen * (1 - n)}`;
}

function renderNeedle(needleEl, normalized) {
  if (!needleEl) return;
  const n = clamp(normalized, 0, 1);
  const deg = -90 + n * 180;
  needleEl.setAttribute("transform", `translate(160 160) rotate(${deg})`);
}

function extractJsonText(maybeWrappedText) {
  const s = String(maybeWrappedText ?? "").trim();
  if (!s) throw new Error("응답이 비어 있습니다.");
  if (s.startsWith("{") || s.startsWith("[")) return s;

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const naive = s.slice(first, last + 1);
    try {
      JSON.parse(naive);
      return naive;
    } catch {
      // fall through to robust scan
    }
  }

  const starts = [];
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "{" || ch === "[") starts.push(i);
  }

  const tryExtractBalanced = (startIdx) => {
    const stack = [];
    let inStr = false;
    let esc = false;

    const open = s[startIdx];
    if (open !== "{" && open !== "[") return null;
    stack.push(open);

    for (let i = startIdx + 1; i < s.length; i += 1) {
      const ch = s[i];

      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = false;
        }
        continue;
      }

      if (ch === '"') {
        inStr = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }

      if (ch === "}" || ch === "]") {
        const top = stack[stack.length - 1];
        if ((ch === "}" && top !== "{") || (ch === "]" && top !== "[")) return null;
        stack.pop();
        if (stack.length === 0) return s.slice(startIdx, i + 1);
      }
    }

    return null;
  };

  for (const startIdx of starts) {
    const candidate = tryExtractBalanced(startIdx);
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // keep scanning
    }
  }

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

function pointClose(p) {
  if (Number.isFinite(p.close)) return p.close;
  if (Number.isFinite(p.high)) return p.high;
  if (Number.isFinite(p.low)) return p.low;
  return NaN;
}

function computeAvgDrawdownPctOverYears(points, years) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const y = Number.isFinite(years) && years > 0 ? years : 10;

  const lastTs = points[points.length - 1]?.ts;
  if (!Number.isFinite(lastTs)) return null;

  const cutoffDate = new Date(lastTs * 1000);
  cutoffDate.setUTCFullYear(cutoffDate.getUTCFullYear() - y);
  const cutoffTs = Math.floor(cutoffDate.getTime() / 1000);

  let peakHigh = pointHigh(points[0]);
  let sum = 0;
  let count = 0;

  for (const p of points) {
    const h = pointHigh(p);
    if (Number.isFinite(h) && h > peakHigh) peakHigh = h;

    if (!Number.isFinite(p.ts) || p.ts < cutoffTs) continue;

    const c = pointClose(p);
    if (!Number.isFinite(c) || !Number.isFinite(peakHigh) || peakHigh <= 0) continue;

    const dd = ((peakHigh - c) / peakHigh) * 100;
    if (!Number.isFinite(dd)) continue;

    sum += Math.max(0, dd);
    count += 1;
  }

  return count ? sum / count : null;
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
  const metaTime = result?.meta?.regularMarketTime;
  const metaDayHigh = result?.meta?.regularMarketDayHigh;
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
    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText}`);
      err.status = res.status;
      const ra = res.headers?.get?.("retry-after");
      const raNum = ra != null ? Number(ra) : NaN;
      if (Number.isFinite(raNum)) err.retryAfterSec = raNum;
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function allOriginsRaw(url) {
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
}

async function loadGlobal() {
  const chart =
    "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=max&interval=1d&includeAdjustedClose=true";
  const chartAlt =
    "https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=max&interval=1d&includeAdjustedClose=true";

  const jina = `https://r.jina.ai/http://${chart.replace(/^https?:\/\//, "")}`;
  const jinaAlt = `https://r.jina.ai/http://${chartAlt.replace(/^https?:\/\//, "")}`;
  const ao = allOriginsRaw(chart);
  const aoAlt = allOriginsRaw(chartAlt);

  // Prefer CORS-friendly proxies first to avoid browser fetch failures (net::ERR_FAILED 200 (OK)).
  const candidates = [jina, jinaAlt, ao, aoAlt, chart, chartAlt];
  let lastErr;
  for (const url of candidates) {
    try {
      const text = await fetchText(url);
      const { points, currentFromMeta } = parseYahooChartSeries(text);
      const parsed = computeAthAndCurrent(points, currentFromMeta);
      const avg10yDropPct = computeAvgDrawdownPctOverYears(points, 10);
      return { source: url, avg10yDropPct, ...parsed };
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
  const ao = allOriginsRaw(base);
  const aoAlt = allOriginsRaw(alt);

  // Prefer CORS-friendly proxies first to avoid browser fetch failures (net::ERR_FAILED 200 (OK)).
  const candidates = [jina, jinaAlt, ao, aoAlt, base, alt];
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

async function loadEtfQuotes(symbols) {
  const list = Array.isArray(symbols) && symbols.length ? symbols : ETFS.map((e) => e.symbol);
  const joined = encodeURIComponent(list.join(","));

  const base = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}`;
  const alt = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${joined}`;
  const jina = `https://r.jina.ai/http://${base.replace(/^https?:\/\//, "")}`;
  const jinaAlt = `https://r.jina.ai/http://${alt.replace(/^https?:\/\//, "")}`;
  const ao = allOriginsRaw(base);
  const aoAlt = allOriginsRaw(alt);

  // Prefer CORS-friendly proxies first to avoid browser fetch failures (net::ERR_FAILED 200 (OK)).
  const candidates = [jina, jinaAlt, ao, aoAlt, base, alt];
  let lastErr;
  for (const url of candidates) {
    try {
      const text = await fetchText(url, { timeoutMs: 12000 });
      const raw = extractJsonText(text);
      const json = JSON.parse(raw);
      const results = json?.quoteResponse?.result;
      if (!Array.isArray(results) || results.length === 0) throw new Error("Yahoo Finance quote 데이터가 비어 있습니다.");

      const bySymbol = new Map(results.map((r) => [String(r.symbol || "").toUpperCase(), r]));
      const items = list.map((sym) => {
        const r = bySymbol.get(String(sym).toUpperCase()) ?? null;
        const label = ETF_LABEL_BY_SYMBOL.get(String(sym).toUpperCase()) ?? sym;
        const price = r?.regularMarketPrice;
        const chg = r?.regularMarketChange;
        const pct = r?.regularMarketChangePercent;
        const currency = r?.currency || "USD";
        const name = r?.shortName || r?.longName || sym;
        const time = r?.regularMarketTime;
        const asOfMs = Number.isFinite(time) ? time * 1000 : null;
        return {
          symbol: sym,
          label,
          name,
          currency,
          price: Number.isFinite(price) ? price : null,
          change: Number.isFinite(chg) ? chg : null,
          changePct: Number.isFinite(pct) ? pct : null,
          asOfMs,
        };
      });

      const missing = items
        .filter((it) => it.price == null || it.change == null || it.changePct == null)
        .map((it) => it.symbol);

      if (missing.length) {
        const viaChart = await loadEtfQuotesViaChart(missing);
        const by = new Map(viaChart.items.map((it) => [String(it.symbol).toUpperCase(), it]));
        for (const it of items) {
          const repl = by.get(String(it.symbol).toUpperCase());
          if (!repl) continue;
          if (it.price == null) it.price = repl.price;
          if (it.change == null) it.change = repl.change;
          if (it.changePct == null) it.changePct = repl.changePct;
          if (it.asOfMs == null) it.asOfMs = repl.asOfMs;
          if (!it.name || it.name === it.symbol) it.name = repl.name;
          if (!it.currency) it.currency = repl.currency;
          if (!it.label || it.label === it.symbol) it.label = repl.label;
        }
      }

      return { source: url, items };
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    const fallback = await loadEtfQuotesViaChart(list);
    return { source: fallback.source, items: fallback.items };
  } catch {
    throw lastErr ?? new Error("ETF 데이터를 불러오지 못했습니다.");
  }
}

function lastFinite(values) {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function lastTwoFinite(values) {
  if (!Array.isArray(values)) return { last: null, prev: null };
  let last = null;
  let prev = null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (last == null) {
      last = v;
      continue;
    }
    prev = v;
    break;
  }
  return { last, prev };
}

function parseEtfFromYahooChart(text, fallbackSymbol) {
  const raw = extractJsonText(text);
  const json = JSON.parse(raw);

  const error = json?.chart?.error;
  if (error) throw new Error(`Yahoo Finance 오류: ${error.description || error.code || "unknown"}`);

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo Finance 차트 데이터가 비어 있습니다.");

  const meta = result?.meta ?? {};
  const symbol = String(meta.symbol || fallbackSymbol || "--");
  const currency = String(meta.currency || "USD");
  const name = String(meta.shortName || meta.longName || symbol);
  const label = ETF_LABEL_BY_SYMBOL.get(String(fallbackSymbol || symbol).toUpperCase()) ?? symbol;

  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const { last: lastClose, prev: prevCloseFromSeries } = lastTwoFinite(closes);

  const metaPrice = meta?.regularMarketPrice;
  const metaPrev = meta?.previousClose ?? meta?.chartPreviousClose;

  const price = Number.isFinite(metaPrice) ? metaPrice : lastClose;
  const prev = Number.isFinite(metaPrev) ? metaPrev : prevCloseFromSeries;

  const change = Number.isFinite(price) && Number.isFinite(prev) ? price - prev : null;
  const changePct = Number.isFinite(change) && Number.isFinite(prev) && prev !== 0 ? (change / prev) * 100 : null;

  const t = meta?.regularMarketTime;
  const ts = lastFinite(result?.timestamp ?? []);
  const asOfMs = Number.isFinite(t) ? t * 1000 : Number.isFinite(ts) ? ts * 1000 : null;

  return {
    symbol,
    label,
    name,
    currency,
    price: Number.isFinite(price) ? price : null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    asOfMs,
  };
}

async function loadEtfQuotesViaChart(symbols) {
  const list = Array.isArray(symbols) && symbols.length ? symbols : ETFS.map((e) => e.symbol);
  const items = [];
  let usedSource = "chart";

  for (const sym of list) {
    const s = encodeURIComponent(sym);
    const base = `https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=5d&interval=1d&includeAdjustedClose=true`;
    const alt = `https://query2.finance.yahoo.com/v8/finance/chart/${s}?range=5d&interval=1d&includeAdjustedClose=true`;
    const jina = `https://r.jina.ai/http://${base.replace(/^https?:\/\//, "")}`;
    const jinaAlt = `https://r.jina.ai/http://${alt.replace(/^https?:\/\//, "")}`;
    const ao = allOriginsRaw(base);
    const aoAlt = allOriginsRaw(alt);

    // Prefer CORS-friendly proxies first to avoid browser fetch failures (net::ERR_FAILED 200 (OK)).
    const candidates = [jina, jinaAlt, ao, aoAlt, base, alt];
    let lastErr;
    for (const url of candidates) {
      try {
        const text = await fetchText(url, { timeoutMs: 12000 });
        const item = parseEtfFromYahooChart(text, sym);
        items.push({ ...item, symbol: sym, label: item.label ?? (ETF_LABEL_BY_SYMBOL.get(String(sym).toUpperCase()) ?? sym) });
        usedSource = url;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!items.find((it) => it.symbol === sym)) {
      throw lastErr ?? new Error(`ETF 차트 로드 실패: ${sym}`);
    }

    // small spacing to reduce rate-limit bursts
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 150));
  }

  return { source: usedSource, items };
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
  while (node?.firstChild) node.removeChild(node.firstChild);
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
  if (!ui.spxGauge.marks) return;
  clearSvgChildren(ui.spxGauge.marks);
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

    ui.spxGauge.marks.appendChild(ring);
    ui.spxGauge.marks.appendChild(dot);
  });
}

function renderSpxSnapshot(snapshot, { fromCache } = { fromCache: false }) {
  const { current, ath, computed, updatedAt } = snapshot;

  if (ui.avg10yBadge) {
    const avg = snapshot?.avg10yDropPct;
    const pct = Number.isFinite(avg) ? fmt.drawdownPercent(avg, 2) : "--%";
    ui.avg10yBadge.textContent = `10년 평균 ${pct}`;
    ui.avg10yBadge.title = "최근 10년(일간) 평균: 당시의 최고점 대비 종가 하락률";
  }

  ui.dropPct.textContent = fmt.drawdownPercent(computed.dropPct, 2);
  ui.dropPts.textContent = `${fmt.number(computed.dropPts, 2)} pt`;
  ui.currentVal.textContent = `${fmt.number(current.close, 2)} (${current.date})`;
  ui.athVal.textContent = `${fmt.number(ath.close, 2)} (${ath.date})`;
  ui.asofVal.textContent = current.date;
  ui.updatedVal.textContent = `${fmt.dt(updatedAt)}${fromCache ? " (캐시)" : ""}`;

  const normalized = clamp((computed.dropPct ?? 0) / 100, 0, 1);
  renderArc(ui.spxGauge.arc, normalized);
  renderNeedle(ui.spxGauge.needle, normalized);
  ui.spxGauge.value.textContent = fmt.drawdownPercent(computed.dropPct, 2);
}

function renderEtfQuotes(snapshot, { fromCache } = { fromCache: false }) {
  if (!ui.etfList) return;

  if (!snapshot?.items?.length) {
    ui.etfList.innerHTML = `<div class="muted">불러오는 중…</div>`;
    return;
  }

  ui.etfList.innerHTML = snapshot.items
    .map((it) => {
      const cls = signClass(it.change);
      const price = it.price == null ? "--" : fmt.number(it.price, 2);
      const chg = it.change == null ? "--" : fmtSigned(it.change, 2);
      const pct = it.changePct == null ? "--%" : fmtSignedPercent(it.changePct, 2);
      const titleParts = [];
      if (it.asOfMs) titleParts.push(`기준: ${fmt.dt(it.asOfMs)}`);
      if (fromCache) titleParts.push("캐시");
      const title = titleParts.join(" · ");
      const head = it.label || it.symbol;
      const sym = String(it.symbol || "").trim();
      const href = googleFinanceUrlForEtfSymbol(sym);

      return `
        <a class="etfCard etfLink" href="${href}" target="_blank" rel="noopener noreferrer" title="${title}">
          <div class="etfTop">
            <div class="etfSymbol">${escapeHtml(head)}</div>
            <div class="etfName">${escapeHtml(it.symbol)}</div>
          </div>
          <div class="etfPrice">
            ${price} <span class="etfCurrency">${escapeHtml(it.currency)}</span>
          </div>
          <div class="etfChange ${cls}">
            <div class="chg">${chg}</div>
            <div class="pct">${pct}</div>
          </div>
        </a>
      `;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fearGreedLabelKo(rating) {
  const r = String(rating ?? "").toLowerCase();
  if (r === "extreme fear") return "극도의 공포";
  if (r === "fear") return "공포";
  if (r === "neutral") return "중립";
  if (r === "greed") return "탐욕";
  if (r === "extreme greed") return "극도의 탐욕";
  return rating || "--";
}

function renderFearGreed(snapshot, { fromCache } = { fromCache: false }) {
  const score = snapshot.score;
  const ratingKo = fearGreedLabelKo(snapshot.rating);
  const asOf = snapshot.asOfMs;

  const normalized = clamp((score ?? 0) / 100, 0, 1);
  renderArc(ui.fngGauge.arc, normalized);
  renderNeedle(ui.fngGauge.needle, normalized);

  ui.fngGauge.value.textContent = Number.isFinite(score) ? fmt.number(score, 0) : "--";
  ui.fngGauge.label.textContent = ratingKo;

  ui.fngScoreKpi.textContent = Number.isFinite(score) ? fmt.number(score, 0) : "--";
  ui.fngRatingKpi.textContent = ratingKo;
  ui.fngScoreRow.textContent = Number.isFinite(score) ? fmt.number(score, 1) : "--";
  ui.fngRatingRow.textContent = ratingKo;
  ui.fngAsOfRow.textContent = asOf ? fmt.dt(asOf) : "--";
  ui.fngUpdatedRow.textContent = `${fmt.dt(snapshot.updatedAt)}${fromCache ? " (캐시)" : ""}`;
}

async function loadFearGreed() {
  const direct = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
  const proxy = "https://r.jina.ai/http://production.dataviz.cnn.io/index/fearandgreed/graphdata";

  const candidates = [proxy, direct];
  let lastErr;
  for (const url of candidates) {
    try {
      const text = await fetchText(url, { timeoutMs: 15000 });
      const raw = extractJsonText(text);
      const json = JSON.parse(raw);
      const fng = json?.fear_and_greed;
      if (!fng) throw new Error("Fear & Greed 데이터가 비어 있습니다.");
      const score = Number.parseFloat(fng.score);
      const rating = fng.rating;
      const ts = fng.timestamp;
      const asOfMs = ts ? Date.parse(ts) : null;

      if (!Number.isFinite(score)) throw new Error("Fear & Greed 점수를 파싱하지 못했습니다.");

      return { source: url, score, rating, asOfMs };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Fear & Greed 데이터를 불러오지 못했습니다.");
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

async function refreshSpxSnapshot() {
  const data = await loadGlobal();
  const computed = computeDrawdown(data);
  const snapshot = {
    current: data.current,
    ath: data.ath,
    avg10yDropPct: data.avg10yDropPct,
    computed,
    source: data.source,
    updatedAt: Date.now(),
  };
  setCache(SNAPSHOT_KEY, snapshot);
  renderSpxSnapshot(snapshot, { fromCache: false });
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

async function refreshFearGreed() {
  const data = await loadFearGreed();
  const snapshot = {
    score: data.score,
    rating: data.rating,
    asOfMs: data.asOfMs,
    source: data.source,
    updatedAt: Date.now(),
  };
  setCache(FNG_KEY, snapshot);
  renderFearGreed(snapshot, { fromCache: false });
}

async function refreshEtfs() {
  setEtfStatus("");
  const cached = getCache(ETF_KEY);
  if (cached?.items?.length) renderEtfQuotes(cached, { fromCache: true });
  else renderEtfQuotes(null);

  const rlUntil = getCache(ETF_RL_UNTIL_KEY)?.untilMs;
  if (Number.isFinite(rlUntil) && Date.now() < rlUntil) {
    const waitSec = Math.max(1, Math.ceil((rlUntil - Date.now()) / 1000));
    setEtfStatus(`요청이 너무 많습니다(429). ${waitSec}초 후 다시 시도하세요.`);
    return;
  }

  try {
    const symbols = ETFS.map((e) => e.symbol);
    const data = await loadEtfQuotes(symbols);
    const snapshot = {
      items: data.items,
      symbols,
      source: data.source,
      updatedAt: Date.now(),
    };
    setCache(ETF_KEY, snapshot);
    renderEtfQuotes(snapshot, { fromCache: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status;
    const retryAfterSec = e?.retryAfterSec;

    if (status === 429) {
      const tail = Number.isFinite(retryAfterSec) ? ` (${Math.max(1, Math.round(retryAfterSec))}초 후 재시도)` : "";
      setEtfStatus(`요청이 너무 많습니다(429). 잠시 후 다시 시도하세요.${tail}`);
      const untilMs = Date.now() + (Number.isFinite(retryAfterSec) ? Math.max(1, retryAfterSec) * 1000 : 60 * 1000);
      setCache(ETF_RL_UNTIL_KEY, { untilMs });
      if (cached?.items?.length) renderEtfQuotes(cached, { fromCache: true });
      return;
    }

    setEtfStatus(`ETF 불러오기 실패: ${msg}`);
    if (cached?.items?.length) renderEtfQuotes(cached, { fromCache: true });
    throw e;
  }
}

async function refreshAll({ force = false } = {}) {
  const taskFns = [];

  if (force || !isCacheFresh(SNAPSHOT_KEY, AUTO_REFRESH_MAX_AGE_MS)) taskFns.push(refreshSpxSnapshot);
  if (force || !isCacheFresh(ETF_KEY, AUTO_REFRESH_MAX_AGE_MS, { validate: etfSnapshotHasAllSymbols })) taskFns.push(refreshEtfs);
  if (force || !isCacheFresh(FNG_KEY, AUTO_REFRESH_MAX_AGE_MS)) taskFns.push(refreshFearGreed);

  if (taskFns.length === 0) {
    setStatus("");
    return;
  }

  setStatus("데이터 불러오는 중…");
  ui.refreshBtn.disabled = true;

  const errors = [];
  for (const fn of taskFns) {
    try {
      // Avoid hitting Yahoo endpoints simultaneously (429 mitigation)
      // eslint-disable-next-line no-await-in-loop
      await fn();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  setStatus(errors.length ? `실패: ${errors.join(" | ")}` : "");
  ui.refreshBtn.disabled = false;
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

  const cachedSpx = getCache(SNAPSHOT_KEY);
  if (cachedSpx?.computed?.dropPct != null) {
    renderSpxSnapshot(cachedSpx, { fromCache: true });
  } else {
    renderArc(ui.spxGauge.arc, 0);
    renderNeedle(ui.spxGauge.needle, 0);
  }

  const cachedFng = getCache(FNG_KEY);
  if (cachedFng?.score != null) {
    renderFearGreed(cachedFng, { fromCache: true });
  } else {
    renderArc(ui.fngGauge.arc, 0);
    renderNeedle(ui.fngGauge.needle, 0);
  }

  const cachedEtfs = getCache(ETF_KEY);
  if (cachedEtfs?.items?.length && etfSnapshotHasAllSymbols(cachedEtfs)) {
    renderEtfQuotes(cachedEtfs, { fromCache: true });
  } else {
    renderEtfQuotes(null);
  }

  ui.refreshBtn.addEventListener("click", async () => {
    await refreshAll({ force: true });
  });

  await Promise.all([refreshAll({ force: false }), refreshCrises()]);
}

init();
