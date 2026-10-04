const FUYAO_BASE_URL = "https://fuyao.aicubes.cn";
const INDEX_CODE = "000300.SH";
const THSCODE_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;
// Vercel Hobby functions have a short execution ceiling; keep this MVP bounded.
const EVALUATION_LIMIT = 3;
const DEFAULT_PE_LIMIT = 25;
const GROWTH_LIMIT = 0.10;
const VOLATILITY_LIMIT = 0.30;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function json(response, status, body) {
  return response.status(status).json(body);
}

async function fuyao(path, apiKey, timeoutMs = 4500) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const upstream = await fetch(`${FUYAO_BASE_URL}${path}`, {
        headers: { "X-api-key": apiKey },
        signal: controller.signal,
      });
      const payload = await upstream.json();
      const ok = upstream.ok && (payload.code === 0 || payload.code === 200);
      const retryable = upstream.status === 429 || upstream.status >= 500;
      if (ok || !retryable || attempt === 1) return { ok, payload, retries: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Fuyao request failed.");
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

async function evaluateStock(stock, valuation, apiKey, endMs, peLimit, isStale) {
  const code = stock.thscode;
  const requestIds = { valuation: requestId(valuation.__payload) };
  const retryCounts = { valuation: valuation.__retries || 0 };
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
    retryCounts.financials = financialResult.value.retries || 0;
  } else if (financialResult.status === "fulfilled") {
    growth.reason = financialResult.value.payload?.message || growth.reason;
    requestIds.financials = requestId(financialResult.value.payload);
    retryCounts.financials = financialResult.value.retries || 0;
  }
  if (priceResult.status === "fulfilled" && priceResult.value.ok) {
    volatility = calculateVolatility(getItems(priceResult.value.payload));
    requestIds.prices = requestId(priceResult.value.payload);
    retryCounts.prices = priceResult.value.retries || 0;
  } else if (priceResult.status === "fulfilled") {
    volatility.reason = priceResult.value.payload?.message || volatility.reason;
    requestIds.prices = requestId(priceResult.value.payload);
    retryCounts.prices = priceResult.value.retries || 0;
  }
  const metrics = { growth, pe: peResult, volatility };
  const states = Object.values(metrics).map((metric) => {
    if (metric.status === "TOOL_ERROR") return "TOOL_ERROR";
    if (metric.value === null) return "UNKNOWN";
    return "VALID";
  });
  const overall = states.includes("TOOL_ERROR") ? "TOOL_ERROR" : states.includes("UNKNOWN") ? "UNKNOWN" : "VALID";
  const metricCheck = (metric, pass) => {
    if (metric.status === "TOOL_ERROR") return "TOOL_ERROR";
    if (metric.value === null) return "UNKNOWN";
    if (isStale) return "STALE";
    return pass ? "PASS" : "FAIL";
  };
  const checks = {
    growth: metricCheck(growth, growth.value > GROWTH_LIMIT),
    valuation: metricCheck(peResult, pe < peLimit),
    stability: metricCheck(volatility, volatility.value < VOLATILITY_LIMIT),
  };
  const overallCheck = Object.values(checks).includes("TOOL_ERROR")
    ? "TOOL_ERROR"
    : Object.values(checks).includes("STALE")
      ? "STALE"
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
    retry_counts: retryCounts,
    evidence: {
      growth: { value: growth.value, status: isStale && growth.status === "VALID" ? "STALE" : growth.status, reason: growth.reason, period: "2Y", unit: "ratio", field: "parent_holder_net_profit" },
      valuation: { value: pe, status: isStale && peResult.status === "VALID" ? "STALE" : peResult.status, reason: peResult.reason, period: "TTM", unit: "multiple", field: "pe_ttm" },
      stability: { value: volatility.value, status: isStale && volatility.status === "VALID" ? "STALE" : volatility.status, reason: volatility.reason, period: "60TD", unit: "ratio", field: "close_price" },
    },
  };
}

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const apiKey = process.env.FUYAO_API_KEY;
  if (!apiKey) return json(response, 503, { status: "TOOL_ERROR", message: "FUYAO_API_KEY is not configured." });
  try {
    const rawPe = request.query?.pe_max;
    const requestedPe = Number(request.query?.pe_max);
    if (rawPe !== undefined && (!Number.isFinite(requestedPe) || requestedPe <= 0 || requestedPe > 200)) {
      return json(response, 400, { status: "INVALID", message: "pe_max must be greater than 0 and no more than 200." });
    }
    const peLimit = Number.isFinite(requestedPe) && requestedPe > 0 && requestedPe <= 200 ? requestedPe : DEFAULT_PE_LIMIT;
    const requestedMin = Number(request.query?.pe_min);
    if (Number.isFinite(requestedMin) && requestedMin >= peLimit) {
      return json(response, 409, { status: "CONFLICT", message: `PE lower bound ${requestedMin} must be below upper bound ${peLimit}.` });
    }
    const constituents = await fuyao(`/api/a-share-index/constituents/ths-stock-list?thscode=${INDEX_CODE}`, apiKey);
    if (!constituents.ok) {
      return json(response, 502, { status: "TOOL_ERROR", source: "fuyao", request_id: requestId(constituents.payload), message: constituents.payload?.message || "Unable to load index constituents." });
    }
    const stocks = getItems(constituents.payload).filter((item) => THSCODE_PATTERN.test(item.thscode || ""));
    const universeTotal = stocks.length;
    // Query a bounded slice for the Hobby runtime while retaining the full universe count.
    const valuationStocks = stocks.slice(0, 30);
    const valuation = await fuyao(`/api/a-share/valuations/snapshot?thscodes=${encodeURIComponent(valuationStocks.map((stock) => stock.thscode).join(","))}`, apiKey);
    if (!valuation.ok) {
      return json(response, 502, { status: "TOOL_ERROR", source: "fuyao", request_id: requestId(valuation.payload), universe_total: universeTotal, message: valuation.payload?.message || "Unable to load valuations." });
    }
    const valuationItems = getItems(valuation.payload);
    const byCode = new Map(valuationItems.map((item) => [item.thscode, item]));
    const ranked = valuationStocks
      .map((stock) => ({ stock, valuation: byCode.get(stock.thscode) }))
      .filter((item) => {
        const pe = number(item.valuation?.pe_ttm);
        return pe !== null && pe > 0 && pe < peLimit;
      })
      .slice(0, EVALUATION_LIMIT);
    const endMs = number(valuation.payload?.data?.timestamp) || Date.now();
    const isStale = Date.now() - endMs > STALE_AFTER_MS;
    const results = await Promise.all(ranked.map((item) => evaluateStock(item.stock, { ...item.valuation, __payload: valuation.payload, __retries: valuation.retries }, apiKey, endMs, peLimit, isStale)));
    const allRequestIds = {
      constituents: requestId(constituents.payload),
      valuations: requestId(valuation.payload),
    };
    const partialFailures = results.filter((item) => item.state === "TOOL_ERROR").length;
    const responseStatus = isStale ? "STALE" : ranked.length === 0 ? "ZERO_RESULT" : partialFailures ? "PARTIAL" : "VALID";
    return json(response, 200, {
      status: responseStatus,
      source: "fuyao",
      index: INDEX_CODE,
      as_of: endMs,
      request_id: allRequestIds.valuations || allRequestIds.constituents,
      request_ids: allRequestIds,
      universe_total: universeTotal,
      evaluated_count: results.length,
      partial_failures: partialFailures,
      retry_count: (constituents.retries || 0) + (valuation.retries || 0) + results.reduce((sum, item) => sum + Object.values(item.retry_counts || {}).reduce((itemSum, value) => itemSum + value, 0), 0),
      evaluation_limit: EVALUATION_LIMIT,
      message: responseStatus === "ZERO_RESULT" ? "当前阈值下没有可评估标的。" : responseStatus === "PARTIAL" ? `${partialFailures} 只标的存在工具调用失败，结果已保留。` : responseStatus === "STALE" ? "数据时点超过 7 天，结果仅供核验且不判定 PASS/FAIL。" : "success",
      selection_note: `仅对 PE-TTM < ${peLimit} 的前 ${EVALUATION_LIMIT} 只标的计算财务和波动率，未评估标的不代表 FAIL。`,
      data: results,
    });
  } catch (error) {
    return json(response, 502, { status: "TOOL_ERROR", source: "fuyao", message: error.name === "AbortError" ? "Fuyao request timed out." : "Unable to complete the real-data screening request." });
  }
};
