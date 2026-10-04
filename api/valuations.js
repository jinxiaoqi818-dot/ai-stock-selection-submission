const FUYAO_BASE_URL = "https://fuyao.aicubes.cn";
const THSCODE_PATTERN = /^\d{6}\.(SH|SZ|BJ)$/;

function normalizeCodes(value) {
  const values = String(value || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(values)];

  if (!unique.length || unique.length > 100 || unique.some((code) => !THSCODE_PATTERN.test(code))) {
    return null;
  }
  return unique;
}

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const apiKey = process.env.FUYAO_API_KEY;
  const thscodes = normalizeCodes(request.query.thscodes);

  if (!apiKey) {
    return response.status(503).json({ status: "TOOL_ERROR", message: "FUYAO_API_KEY is not configured." });
  }
  if (!thscodes) {
    return response.status(400).json({
      status: "INVALID",
      message: "Provide 1-100 valid A-share thscodes, separated by commas.",
    });
  }

  try {
    const upstream = await fetch(
      `${FUYAO_BASE_URL}/api/a-share/valuations/snapshot?thscodes=${encodeURIComponent(thscodes.join(","))}`,
      { headers: { "X-api-key": apiKey } },
    );
    const payload = await upstream.json();
    const status = payload.code === 0 ? "VALID" : "TOOL_ERROR";
    return response.status(upstream.ok && payload.code === 0 ? 200 : 502).json({
      status,
      source: "fuyao",
      request_id: payload.request_id || null,
      as_of: payload.data?.timestamp || null,
      message: payload.message || "Unknown upstream response.",
      data: payload.data || null,
    });
  } catch (error) {
    return response.status(502).json({
      status: "TOOL_ERROR",
      source: "fuyao",
      message: "Unable to reach the Fuyao valuation service.",
    });
  }
};
