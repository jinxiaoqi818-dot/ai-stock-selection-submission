const screenHandler = require("./screen.js");

const FUYAO_INDEX_PATH = "/api/a-share-index/constituents/ths-stock-list?thscode=000300.SH";
const INDEX_CODE = "000300.SH";
const MAX_CHUNK_SIZE = 3;
const { fuyao, getItems, requestId, number, evaluateStock } = screenHandler._internal;

function json(response, status, body) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(body);
}

module.exports = async (request, response) => {
  const buildToken = process.env.SNAPSHOT_BUILD_TOKEN;
  const suppliedToken = request.headers["x-snapshot-token"];
  if (!buildToken || suppliedToken !== buildToken) {
    return json(response, 401, { status: "UNAUTHORIZED", message: "Snapshot build authorization failed." });
  }

  const apiKey = process.env.FUYAO_API_KEY;
  if (!apiKey) return json(response, 503, { status: "TOOL_ERROR", message: "FUYAO_API_KEY is not configured." });

  const offset = Number(request.query?.offset);
  const limit = Number(request.query?.limit || MAX_CHUNK_SIZE);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_CHUNK_SIZE) {
    return json(response, 400, { status: "INVALID", message: `offset must be non-negative and limit must be 1-${MAX_CHUNK_SIZE}.` });
  }

  try {
    const constituents = await fuyao(FUYAO_INDEX_PATH, apiKey, 7000);
    if (!constituents.ok) {
      return json(response, 502, { status: "TOOL_ERROR", request_id: requestId(constituents.payload), message: constituents.payload?.message || "Unable to load constituents." });
    }
    const stocks = getItems(constituents.payload);
    const chunk = stocks.slice(offset, offset + limit);
    if (!chunk.length) {
      return json(response, 200, { status: "COMPLETE", index: INDEX_CODE, universe_total: stocks.length, offset, data: [] });
    }
    const codes = chunk.map((stock) => stock.thscode).join(",");
    const valuations = await fuyao(`/api/a-share/valuations/snapshot?thscodes=${encodeURIComponent(codes)}`, apiKey, 7000);
    if (!valuations.ok) {
      return json(response, 502, { status: "TOOL_ERROR", request_id: requestId(valuations.payload), offset, message: valuations.payload?.message || "Unable to load valuations." });
    }
    const valuationByCode = new Map(getItems(valuations.payload).map((item) => [item.thscode, item]));
    const endMs = number(valuations.payload?.data?.timestamp) || Date.now();
    const isStale = Date.now() - endMs > 7 * 24 * 60 * 60 * 1000;
    const results = await Promise.all(chunk.map(async (stock) => {
      const valuation = valuationByCode.get(stock.thscode) || { thscode: stock.thscode, pe_ttm: null };
      return evaluateStock(stock, { ...valuation, __payload: valuations.payload, __retries: valuations.retries }, apiKey, endMs, Number.MAX_SAFE_INTEGER, isStale);
    }));
    return json(response, 200, {
      status: results.some((item) => item.state === "TOOL_ERROR") ? "PARTIAL" : isStale ? "STALE" : "VALID",
      index: INDEX_CODE,
      universe_total: stocks.length,
      offset,
      limit: chunk.length,
      as_of: endMs,
      request_ids: {
        constituents: requestId(constituents.payload),
        valuations: requestId(valuations.payload),
      },
      data: results,
    });
  } catch (error) {
    return json(response, 502, { status: "TOOL_ERROR", offset, message: error.name === "AbortError" ? "Snapshot chunk timed out." : "Unable to build snapshot chunk." });
  }
};
