const FUYAO_BASE_URL = "https://fuyao.aicubes.cn";
const INDEX_CODE = "000300.SH";
const THSCODE_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;
// Vercel Hobby functions have a short execution ceiling; keep this MVP bounded.
const EVALUATION_LIMIT = 3;
const PE_LIMIT = 25;
const GROWTH_LIMIT = 0.10;
const VOLATILITY_LIMIT = 0.30;

function json(response, status, body) {
  return response.status(status).json(body);
}

async function fuyao(path, apiKey, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(`${FUYAO_BASE_URL}${path}`, {
      headers: { "X-api-key": apiKey },
      signal: controller.signal,
    });
    const payload = await upstream.json();
    return { ok: upstream.ok && (payload.code === 0 || payload.code === 200), payload };
  } finally {
    clearTimeout(timer);
  }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getItems(payload) {
  return Array.isArray(payload?.data?.item) ? payload.data.item : [];
}

function requestId(payload) {
  return payload?.request_id || null;
}

function calculateGrowth(items) {
  const rows = items
    .map((item) => ({
      period: number(item.period_end_ms),
      profit: number(item.parent_holder_net_profit ?? item.net_profit),
    }))
    .filter((item) => item.period !== null && item.profit !== null)
    .sort((a, b) => a.period - b.period);
  if (rows.length < 3) return { value: null, status: "UNKNOWN", reason: "最近三期年报不足" };
  const oldest = rows[0].profit;
  const latest = rows[rows.length - 1].profit;
  if (oldest <= 0 || latest <= 0) return { value: null, status: "UNKNOWN", reason: "利润基期非正，无法计算 CAGR" };
  return { value: Math.pow(latest / oldest, 1 / 2) - 1, status: "VALID", reason: "最近三期年报" };
}

function calculateVolatility(items) {
  const closes = items
    .map((item) => ({ date: number(item.date_ms), close: number(item.close_price ?? item.close) }))
    .filter((item) => item.date !== null && item.close !== null && item.close > 0)
    .sort((a, b) => a.date - b.date)
    .slice(-61);
  if (closes.length < 61) return { value: null, status: "UNKNOWN", reason: `有效收盘价仅 ${closes.length}/61 根` };
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) returns.push(Math.log(closes[i].close / closes[i - 1].close));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
  return { value: Math.sqrt(variance) * Math.sqrt(252), status: "VALID", reason: "最近 60 个交易日对数收益率年化" };
}

async function evaluateStock(stock, valuation, apiKey, endMs) {
  const code = stock.thscode;
  const requestIds = { valuation: requestId(valuation.__payload) };
  const pe = number(valuation.pe_ttm);
  const peResult = pe === null
    ? { value: null, status: "UNKNOWN", reason: "PE-TTM 缺失" }
    : { value: pe, status: "VALID", reason: "估值快照" };
  const startMs = endMs - (190 * 24 * 60 * 60 * 1000);
  const [financialResult, priceResult] = await Promise.allSettled([
    fuyao(`/api/a-share/financials/income-statements?thscode=${encodeURIComponent(code)}&period=annual&limit=3`, apiKey),
    fuyao(`/api/a-share/prices/historical?thscode=${encodeURIComponent(code)}&interval=1d&start=${startMs}&end=${endMs}&adjust=forward`, apiKey),
  ]);
  let growth = { value: null, status: "TOOL_ERROR", reason: "财务数据请求失败" };
  let volatility = { value: null, status: "TOOL_ERROR", reason: "历史行情请求失败" };
  if (financialResult.status === "fulfilled" && financialResult.value.ok) {
    growth = calculateGrowth(getItems(financialResult.value.payload));
    requestIds.financials = requestId(financialResult.value.payload);
  } else if (financialResult.status === "fulfilled") {
    growth.reason = financialResult.value.payload?.message || growth.reason;
    requestIds.financials = requestId(financialResult.value.payload);
  }
  if (priceResult.status === "fulfilled" && priceResult.value.ok) {
    volatility = calculateVolatility(getItems(priceResult.value.payload));
    requestIds.prices = requestId(priceResult.value.payload);
  } else if (priceResult.status === "fulfilled") {
    volatility.reason = priceResult.value.payload?.message || volatility.reason;
    requestIds.prices = requestId(priceResult.value.payload);
  }
  const metrics = { growth, pe: peResult, volatility };
  const states = Object.values(metrics).map((metric) => {
    if (metric.status === "TOOL_ERROR") return "TOOL_ERROR";
    if (metric.value === null) return "UNKNOWN";
    return "VALID";
  });
  const overall = states.includes("TOOL_ERROR") ? "TOOL_ERROR" : states.includes("UNKNOWN") ? "UNKNOWN" : "VALID";
  const checks = {
    growth: growth.value === null ? "UNKNOWN" : growth.value > GROWTH_LIMIT ? "PASS" : "FAIL",
    valuation: pe === null ? "UNKNOWN" : pe < PE_LIMIT ? "PASS" : "FAIL",
    stability: volatility.value === null ? "UNKNOWN" : volatility.value < VOLATILITY_LIMIT ? "PASS" : "FAIL",
  };
  const overallCheck = Object.values(checks).includes("TOOL_ERROR")
    ? "TOOL_ERROR"
    : Object.values(checks).includes("UNKNOWN") || overall === "TOOL_ERROR"
      ? overall
      : Object.values(checks).every((state) => state === "PASS") ? "PASS" : "FAIL";
  return {
    name: stock.name || stock.ticker || code,
    code,
    growth: growth.value,
    pe,
    volatility: volatility.value,
    checks,
    state: overallCheck,
    source: "fuyao",
    asOf: new Date(endMs).toISOString(),
    request_ids: requestIds,
    evidence: {
      growth: { value: growth.value, status: growth.status, reason: growth.reason, period: "2Y", unit: "ratio", field: "parent_holder_net_profit" },
      valuation: { value: pe, status: peResult.status, reason: peResult.reason, period: "TTM", unit: "multiple", field: "pe_ttm" },
      stability: { value: volatility.value, status: volatility.status, reason: volatility.reason, period: "60TD", unit: "ratio", field: "close_price" },
    },
  };
}

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const apiKey = process.env.FUYAO_API_KEY;
  if (!apiKey) return json(response, 503, { status: "TOOL_ERROR", message: "FUYAO_API_KEY is not configured." });
  try {
    const constituents = await fuyao(`/api/a-share-index/constituents/ths-stock-list?thscode=${INDEX_CODE}`, apiKey);
    if (!constituents.ok) {
      return json(response, 502, { status: "TOOL_ERROR", source: "fuyao", request_id: requestId(constituents.payload), message: constituents.payload?.message || "Unable to load index constituents." });
    }
    const stocks = getItems(constituents.payload).filter((item) => THSCODE_PATTERN.test(item.thscode || ""));
    const universeTotal = stocks.length;
    const valuation = await fuyao(`/api/a-share/valuations/snapshot?thscodes=${encodeURIComponent(stocks.map((stock) => stock.thscode).join(","))}`, apiKey);
    if (!valuation.ok) {
      return json(response, 502, { status: "TOOL_ERROR", source: "fuyao", request_id: requestId(valuation.payload), universe_total: universeTotal, message: valuation.payload?.message || "Unable to load valuations." });
    }
    const valuationItems = getItems(valuation.payload);
    const byCode = new Map(valuationItems.map((item) => [item.thscode, item]));
    const ranked = stocks
      .map((stock) => ({ stock, valuation: byCode.get(stock.thscode) }))
      .filter((item) => item.valuation && number(item.valuation.pe_ttm) !== null && number(item.valuation.pe_ttm) < PE_LIMIT)
      .slice(0, EVALUATION_LIMIT);
    const endMs = number(valuation.payload?.data?.timestamp) || Date.now();
    const results = await Promise.all(ranked.map((item) => evaluateStock(item.stock, { ...item.valuation, __payload: valuation.payload }, apiKey, endMs)));
    const allRequestIds = {
      constituents: requestId(constituents.payload),
      valuations: requestId(valuation.payload),
    };
    return json(response, 200, {
      status: "VALID",
      source: "fuyao",
      index: INDEX_CODE,
      as_of: endMs,
      request_id: allRequestIds.valuations || allRequestIds.constituents,
      request_ids: allRequestIds,
      universe_total: universeTotal,
      evaluated_count: results.length,
      evaluation_limit: EVALUATION_LIMIT,
      selection_note: `仅对 PE-TTM < ${PE_LIMIT} 的前 ${EVALUATION_LIMIT} 只标的计算财务和波动率，未评估标的不代表 FAIL。`,
      data: results,
    });
  } catch (error) {
    return json(response, 502, { status: "TOOL_ERROR", source: "fuyao", message: error.name === "AbortError" ? "Fuyao request timed out." : "Unable to complete the real-data screening request." });
  }
};
