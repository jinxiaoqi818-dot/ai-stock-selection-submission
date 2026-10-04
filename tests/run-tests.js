const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const screenHandler = require("../api/screen.js");

const ROOT = path.resolve(__dirname, "..");
const PROD = "https://ai-stock-selection-submission.vercel.app";
const results = [];

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, status: "PASS", duration_ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", duration_ms: Date.now() - started, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

function getJson(url) {
  const marker = "__HTTP_STATUS__";
  const script = `$ProgressPreference='SilentlyContinue'; $r=Invoke-WebRequest -Uri '${url}' -UseBasicParsing -TimeoutSec 40 -SkipHttpErrorCheck; Write-Output ($r.Content + '${marker}' + [int]$r.StatusCode)`;
  const output = execFileSync("pwsh.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
  const markerIndex = output.lastIndexOf(marker);
  assert.ok(markerIndex >= 0, "curl response did not include HTTP status");
  return { response: { status: Number(output.slice(markerIndex + marker.length)) }, body: JSON.parse(output.slice(0, markerIndex)) };
}

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run() {
  await test("CAGR uses three annual observations", () => {
    const value = screenHandler._test.calculateGrowth([
      { period_end_ms: 1, parent_holder_net_profit: 100 },
      { period_end_ms: 2, parent_holder_net_profit: 121 },
      { period_end_ms: 3, parent_holder_net_profit: 144 },
    ]);
    assert.equal(value.status, "VALID");
    assert.ok(Math.abs(value.value - 0.2) < 1e-10);
  });

  await test("CAGR missing observations stays UNKNOWN", () => {
    const value = screenHandler._test.calculateGrowth([{ period_end_ms: 1, parent_holder_net_profit: 100 }]);
    assert.equal(value.status, "UNKNOWN");
    assert.equal(value.value, null);
  });

  await test("Null numeric fields remain missing", () => {
    assert.equal(screenHandler._test.number(null), null);
    assert.equal(screenHandler._test.number(""), null);
  });

  await test("60-day volatility requires 61 closes", () => {
    const short = screenHandler._test.calculateVolatility(Array.from({ length: 60 }, (_, i) => ({ date_ms: i + 1, close_price: 100 + i })));
    assert.equal(short.status, "UNKNOWN");
    const full = screenHandler._test.calculateVolatility(Array.from({ length: 61 }, (_, i) => ({ date_ms: i + 1, close_price: 100 * Math.exp(i * 0.001) })));
    assert.equal(full.status, "VALID");
    assert.ok(full.value < 1e-10);
  });

  await test("Invalid parameter returns INVALID before tool calls", async () => {
    const previous = process.env.FUYAO_API_KEY;
    process.env.FUYAO_API_KEY = "test-only-placeholder";
    const response = mockResponse();
    await screenHandler({ query: { pe_max: "bad" } }, response);
    if (previous === undefined) delete process.env.FUYAO_API_KEY; else process.env.FUYAO_API_KEY = previous;
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.status, "INVALID");
  });

  await test("Conflicting bounds return CONFLICT before tool calls", async () => {
    const previous = process.env.FUYAO_API_KEY;
    process.env.FUYAO_API_KEY = "test-only-placeholder";
    const response = mockResponse();
    await screenHandler({ query: { pe_min: "30", pe_max: "20" } }, response);
    if (previous === undefined) delete process.env.FUYAO_API_KEY; else process.env.FUYAO_API_KEY = previous;
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.status, "CONFLICT");
  });

  await test("Compliance boundary and abnormal states are present", () => {
    const app = fs.readFileSync(path.join(ROOT, "demo", "app.js"), "utf8");
    for (const marker of ["不生成涨跌预测", "TOOL_ERROR", "STALE", "CONFLICT", "ZERO_RESULT", "PARTIAL"]) assert.ok(app.includes(marker), `missing ${marker}`);
    assert.ok(!app.includes("远航科技"), "constructed security data remains in the main UI");
  });

  await test("Strategy Canvas and reuse MVP are present", () => {
    const html = fs.readFileSync(path.join(ROOT, "demo", "index.html"), "utf8");
    const app = fs.readFileSync(path.join(ROOT, "demo", "app.js"), "utf8");
    for (const marker of ["Strategy Canvas", "clarificationAck", "strategyName", "saveButton", "rerunButton", "executionHistory"]) assert.ok(html.includes(marker), `missing html marker ${marker}`);
    for (const marker of ["threshold_source", "localStorage", "executionSummary", "新增候选", "退出候选"]) assert.ok(app.includes(marker), `missing app marker ${marker}`);
  });

  await test("Tracked files contain no credential-shaped secrets", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString("utf8").split("\0").filter(Boolean);
    const prefixes = [["sk", "fuyao", ""].join("-"), ["ghp", ""].join("_"), ["github", "pat", ""].join("_")];
    const findings = [];
    for (const file of files) {
      const absolute = path.join(ROOT, file);
      const content = fs.readFileSync(absolute);
      if (content.includes(0)) continue;
      const text = content.toString("utf8");
      for (const prefix of prefixes) if (text.includes(prefix)) findings.push(`${file}: ${prefix}`);
    }
    assert.deepEqual(findings, []);
  });

  await test("Production health reports configured Fuyao", async () => {
    const { response, body } = await getJson(`${PROD}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.fuyaoConfigured, true);
  });

  await test("Production real-data screen returns traceable results", async () => {
    const { response, body } = await getJson(`${PROD}/api/screen`);
    assert.equal(response.status, 200);
    assert.ok(["VALID", "PARTIAL", "STALE"].includes(body.status));
    assert.equal(body.source, "fuyao");
    assert.equal(body.mode, "FULL_SNAPSHOT");
    assert.ok(body.request_id);
    assert.equal(body.universe_total, 300);
    assert.equal(body.not_evaluated_count + body.evaluated_count, body.universe_total);
    assert.equal(body.coverage_rate, 1);
    assert.equal(body.not_evaluated_count, 0);
    assert.equal(Object.values(body.category_counts).reduce((sum, value) => sum + value, 0), body.universe_total);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.every((item) => item.request_ids && item.evidence));
  });

  await test("Production zero-result path is explicit", async () => {
    const { response, body } = await getJson(`${PROD}/api/screen?pe_max=0.1`);
    assert.equal(response.status, 200);
    assert.equal(body.status, "ZERO_RESULT");
    assert.equal(body.evaluated_count, body.universe_total);
    assert.equal(body.category_counts.CANDIDATE || 0, 0);
  });

  await test("Production conflict path rejects execution", async () => {
    const { response, body } = await getJson(`${PROD}/api/screen?pe_max=20&pe_min=30`);
    assert.equal(response.status, 409);
    assert.equal(body.status, "CONFLICT");
  });

  const report = {
    run_at: new Date().toISOString(),
    node: process.version,
    production_url: PROD,
    totals: {
      tests: results.length,
      passed: results.filter((item) => item.status === "PASS").length,
      failed: results.filter((item) => item.status === "FAIL").length,
    },
    results,
  };
  fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "results", "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.totals.passed}/${report.totals.tests} tests passed`);
  if (report.totals.failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
