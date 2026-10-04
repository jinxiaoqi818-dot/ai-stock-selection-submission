const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.SNAPSHOT_BASE_URL || "https://ai-stock-selection-submission.vercel.app";
const BUILD_TOKEN = process.env.SNAPSHOT_BUILD_TOKEN;
const CHUNK_SIZE = 3;
const CONCURRENCY = 2;

if (!BUILD_TOKEN) {
  console.error("SNAPSHOT_BUILD_TOKEN is required.");
  process.exit(1);
}

async function fetchChunk(offset, attempt = 0) {
  try {
    const url = `${BASE_URL}/api/snapshot-chunk?offset=${offset}&limit=${CHUNK_SIZE}`;
    const script = `$ProgressPreference='SilentlyContinue'; $h=@{'x-snapshot-token'=$env:SNAPSHOT_BUILD_TOKEN}; $r=Invoke-WebRequest -Uri '${url}' -Headers $h -UseBasicParsing -TimeoutSec 40 -SkipHttpErrorCheck; if([int]$r.StatusCode -ge 400){throw ('HTTP '+[int]$r.StatusCode+' '+$r.Content)}; Write-Output $r.Content`;
    const { stdout } = await execFileAsync("pwsh.exe", ["-NoProfile", "-Command", script], { env: process.env, maxBuffer: 10 * 1024 * 1024, timeout: 50000 });
    const payload = JSON.parse(stdout.trim());
    return payload;
  } catch (error) {
    if (attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    return fetchChunk(offset, attempt + 1);
  }
}

async function runPool(offsets) {
  const output = [];
  let cursor = 0;
  async function worker() {
    while (cursor < offsets.length) {
      const offset = offsets[cursor];
      cursor += 1;
      const payload = await fetchChunk(offset);
      output.push(payload);
      console.log(`snapshot ${Math.min(offset + payload.limit, payload.universe_total)}/${payload.universe_total} (${payload.status})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return output;
}

async function main() {
  const first = await fetchChunk(0);
  const universeTotal = first.universe_total;
  const offsets = [];
  for (let offset = CHUNK_SIZE; offset < universeTotal; offset += CHUNK_SIZE) offsets.push(offset);
  const chunks = [first, ...await runPool(offsets)];
  const items = chunks.flatMap((chunk) => chunk.data).sort((a, b) => a.code.localeCompare(b.code));
  const unique = [...new Map(items.map((item) => [item.code, item])).values()];
  const stateCounts = unique.reduce((counts, item) => {
    counts[item.state] = (counts[item.state] || 0) + 1;
    return counts;
  }, {});
  const snapshot = {
    schema_version: 1,
    snapshot_id: `csi300_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    generated_at: new Date().toISOString(),
    source: "fuyao",
    index: "000300.SH",
    universe_total: universeTotal,
    evaluated_count: unique.length,
    coverage_rate: universeTotal ? unique.length / universeTotal : 0,
    status: unique.length === universeTotal ? "COMPLETE" : "INCOMPLETE",
    state_counts: stateCounts,
    chunks: chunks.map((chunk) => ({ offset: chunk.offset, limit: chunk.limit, status: chunk.status, request_ids: chunk.request_ids })),
    data: unique,
  };
  if (snapshot.status !== "COMPLETE") throw new Error(`Snapshot incomplete: ${unique.length}/${universeTotal}`);
  const directory = path.join(ROOT, "data");
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, "universe-snapshot.json");
  fs.writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${destination}: ${unique.length}/${universeTotal}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
