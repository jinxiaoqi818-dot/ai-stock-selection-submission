const example = "在沪深300里找近两年利润增长较快、PE不要太高、走势比较稳定的公司。";
let threshold = 25;
let growthThreshold = 0.10;
let volatilityThreshold = 0.30;
let version = 1;
let strategyState = null;
const comparedCodes = new Set();
let lastEvidenceTrigger = null;
let securities = [];
let apiMeta = null;

let conditions = [
  { id: "growth", name: "利润增长", metric: "归母净利润两年 CAGR", detail: "建议阈值：大于 10%", operator: ">", value: 0.10, unit: "%", period: "2Y" },
  { id: "valuation", name: "估值", metric: "PE-TTM", detail: "建议阈值：小于 25x", operator: "<", value: () => threshold, unit: "x", period: "TTM" },
  { id: "stability", name: "走势稳定性", metric: "60 日年化波动率", detail: "建议阈值：小于 30%", operator: "<", value: 0.30, unit: "%", period: "60TD" }
];

function createStrategyState(rawText) {
  return {
    strategy_id: `str_${Date.now().toString(36)}`,
    version,
    status: "READY_TO_CONFIRM",
    raw_text: rawText,
    universe: { type: "index", id: "000300.SH", name: "沪深 300", resolution_status: "RESOLVED" },
    conditions: conditions.map((condition) => ({ id: condition.id, metric: condition.metric, operator: condition.operator, value: typeof condition.value === "function" ? condition.value() : condition.value, unit: condition.unit, period: condition.period, status: "PROPOSED" })),
    ambiguities: [],
    audit: [{ event: "PARSED", at: new Date().toISOString(), version }],
  };
}

function parseIntent(text) {
  const ambiguities = [];
  const unsupported = [];
  const normalized = text.replace(/\s+/g, "");
  const hasUniverse = /沪深?300|000300\.SH/i.test(normalized);
  if (!hasUniverse) ambiguities.push("股票池未明确识别；当前仅支持沪深 300（000300.SH）。");
  if (/ESG|分红|股息|ROE|市值|行业/.test(normalized)) unsupported.push("检测到当前 Registry 未支持的指标，请移除后再执行。");
  const growthMatch = normalized.match(/(?:利润|净利润)(?:增长|CAGR|增速)?(?:超过|大于|高于|>|不少于)?(\d+(?:\.\d+)?)%/i);
  growthThreshold = growthMatch ? Number(growthMatch[1]) / 100 : 0.10;
  if (!growthMatch && /利润|增长|增速|CAGR/.test(normalized)) ambiguities.push("“增长较快”未给出阈值，暂以 10% 作为建议值，确认前请核对。");
  const peMatch = normalized.match(/PE(?:-TTM)?(?:不超过|小于|低于|少于|<|不高于|改成)?(\d+(?:\.\d+)?)/i);
  const peMin = normalized.match(/PE.*?(?:大于|高于|>)(\d+(?:\.\d+)?)/i);
  const peMax = normalized.match(/PE.*?(?:小于|低于|不超过|<)(\d+(?:\.\d+)?)/i);
  const conflict = Boolean(peMin && peMax && Number(peMin[1]) >= Number(peMax[1]));
  if (conflict) ambiguities.push(`PE 下限 ${peMin[1]}x 不小于上限 ${peMax[1]}x，条件冲突。`);
  threshold = peMatch ? Number(peMatch[1]) : 25;
  if (!peMatch && /PE|估值|便宜|合理|不要太高/.test(normalized)) ambiguities.push("PE 条件未给出明确上限，暂以 25x 作为建议值，确认前请核对。");
  const volMatch = normalized.match(/(?:波动率|波动)(?:小于|低于|不超过|<)?(\d+(?:\.\d+)?)%/i);
  volatilityThreshold = volMatch ? Number(volMatch[1]) / 100 : 0.30;
  if (!volMatch && /稳定|波动/.test(normalized)) ambiguities.push("“走势稳定”已映射为 60 日年化波动率，但未给出阈值，暂以 30% 作为建议值。");
  if (!hasUniverse) ambiguities.push("请确认股票池后再执行。");
  return { ambiguities: [...ambiguities, ...unsupported], unsupported: unsupported.length > 0, conflict };
}

function syncConditions() {
  conditions = [
    { id: "growth", name: "利润增长", metric: "归母净利润两年 CAGR", detail: `建议阈值：大于 ${(growthThreshold * 100).toFixed(0)}%`, operator: ">", value: growthThreshold, unit: "%", period: "2Y" },
    { id: "valuation", name: "估值", metric: "PE-TTM", detail: `建议阈值：小于 ${threshold}x`, operator: "<", value: () => threshold, unit: "x", period: "TTM" },
    { id: "stability", name: "走势稳定性", metric: "60 日年化波动率", detail: `建议阈值：小于 ${(volatilityThreshold * 100).toFixed(0)}%`, operator: "<", value: volatilityThreshold, unit: "%", period: "60TD" }
  ];
}

const $ = (id) => document.getElementById(id);
function setWorkflow(stage) {
  document.querySelectorAll(".workflow-step").forEach((item) => {
    const itemStage = Number(item.dataset.stage);
    item.classList.toggle("is-active", itemStage === stage);
    item.classList.toggle("is-done", itemStage < stage);
  });
}
function setHeaderVersion(text) { $("headerVersion").textContent = text; }
function percent(v) { return `${(v * 100).toFixed(1)}%`; }
function fmt(condition, value) { return value === null || value === undefined ? "数据缺失" : condition.unit === "%" ? percent(value) : `${value.toFixed(1)}x`; }
function resultFor(security, condition) {
  const key = condition.id === "growth" ? "growth" : condition.id === "valuation" ? "pe" : "volatility";
  const value = security[key];
  const checkKey = condition.id === "valuation" ? "valuation" : condition.id === "stability" ? "stability" : "growth";
  if (security.checks && ["TOOL_ERROR", "STALE", "CONFLICT"].includes(security.checks[checkKey])) return { state: security.checks[checkKey], value, reason: security.checks[checkKey] === "STALE" ? "数据超过有效时效" : security.checks[checkKey] === "CONFLICT" ? "策略版本冲突" : "真实数据工具调用失败" };
  if (value === null || value === undefined) return { state: "UNKNOWN", value, reason: "该指标数据缺失，无法判断" };
  const target = typeof condition.value === "function" ? condition.value() : condition.value;
  const pass = condition.operator === ">" ? value > target : value < target;
  return { state: pass ? "PASS" : "FAIL", value, target, reason: pass ? "满足已确认条件" : "未满足已确认条件" };
}
function overall(security) {
  const states = conditions.map((condition) => resultFor(security, condition).state);
  if (states.includes("TOOL_ERROR")) return "TOOL_ERROR";
  if (states.includes("CONFLICT")) return "CONFLICT";
  if (states.includes("STALE")) return "STALE";
  return states.includes("UNKNOWN") ? "UNKNOWN" : states.every((state) => state === "PASS") ? "PASS" : "FAIL";
}
function statusClass(state) { return state === "PASS" ? "pass" : state === "STALE" ? "stale" : state === "TOOL_ERROR" ? "tool-error" : state === "FAIL" || state === "CONFLICT" ? "fail" : "unknown"; }
function statusText(state) { return state === "PASS" ? "符合" : state === "FAIL" ? "不符合" : state === "TOOL_ERROR" ? "工具错误" : state === "STALE" ? "已过期" : state === "CONFLICT" ? "版本冲突" : "未知"; }
function renderConditions() {
  $("conditionList").innerHTML = conditions.map((condition, i) => {
    const target = typeof condition.value === "function" ? condition.value() : condition.value;
    return `<div class="condition"><span class="condition-index">0${i + 1}</span><div><div class="condition-name">${condition.name} · ${condition.metric}</div><div class="condition-detail">${condition.detail}</div></div><span class="condition-value">${condition.operator} ${fmt(condition, target)}</span><span class="condition-state">待确认</span></div>`;
  }).join("");
}
function renderResults() {
  if (!securities.length) {
    $("resultRows").innerHTML = `<tr><td colspan="7" class="empty-state">ZERO_RESULT：当前阈值下没有可展示标的。请调整条件后重新执行；零结果不等于工具失败。</td></tr>`;
  }
  const rows = securities.map((security) => {
    const outcomes = conditions.map((condition) => resultFor(security, condition));
    const state = overall(security);
    const selected = comparedCodes.has(security.code);
    const disabled = comparedCodes.size >= 3 && !selected ? "disabled" : "";
    return `<tr><td class="security">${security.name}<span>${security.code}</span></td>${outcomes.map((outcome, index) => `<td><span class="status ${statusClass(outcome.state)}">${outcome.state}</span><span class="mini">${outcome.value === null ? "数据缺失" : conditionValue(outcome, conditions[index])}</span></td>`).join("")}<td><span class="status ${statusClass(state)}">${statusText(state)}</span></td><td><label class="compare-choice"><input class="compare-input" type="checkbox" data-code="${security.code}" ${selected ? "checked" : ""} ${disabled} /><span>加入对比</span></label></td><td><button class="evidence-button" data-code="${security.code}" type="button">查看证据</button></td></tr>`;
  }).join("");
  if (rows) $("resultRows").innerHTML = rows;
  const growthPass = securities.filter(s => resultFor(s, conditions[0]).state === "PASS").length;
  const valPassAfterGrowth = securities.filter(s => resultFor(s, conditions[0]).state === "PASS" && resultFor(s, conditions[1]).state === "PASS").length;
  const candidates = securities.filter(s => overall(s) === "PASS").length;
  $("growthCount").textContent = growthPass;
  $("valuationCount").textContent = valPassAfterGrowth;
  $("candidateCount").textContent = candidates;
  $("evaluatedCount").textContent = apiMeta?.evaluated_count ?? securities.length;
  $("versionTag").textContent = `策略 v${version}`;
  const fullCoverage = apiMeta?.mode === "FULL_SNAPSHOT" && apiMeta.coverage_rate === 1;
  const metaText = apiMeta ? `${fullCoverage ? "真实数据全量快照" : "真实数据样本验证"}：${apiMeta.evaluated_count}/${apiMeta.universe_total} 只已评估，覆盖率 ${((apiMeta.coverage_rate || 0) * 100).toFixed(1)}%；状态 ${apiMeta.status}；${apiMeta.selection_note || apiMeta.message || ""}` : "";
  $("resultSubtitle").textContent = `已确认：利润 CAGR > ${(growthThreshold * 100).toFixed(0)}%，PE-TTM < ${threshold}x，60 日波动率 < ${(volatilityThreshold * 100).toFixed(0)}%。${metaText}`;
  const asOf = apiMeta?.as_of ? new Date(apiMeta.as_of).toLocaleString("zh-CN", { hour12: false }) : "未获取";
  const asOfTag = document.querySelector(".result-tags .tag:last-child");
  if (asOfTag) asOfTag.textContent = `as of ${asOf}`;
  document.querySelectorAll(".evidence-button").forEach((button) => button.addEventListener("click", () => openEvidence(button.dataset.code, button)));
  document.querySelectorAll(".compare-input").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) comparedCodes.add(input.dataset.code); else comparedCodes.delete(input.dataset.code);
    renderResults();
    if (comparedCodes.size >= 2) setWorkflow(4);
  }));
  renderComparison();
}
function conditionValue(outcome, condition) { return outcome.value === null ? "数据缺失" : fmt(condition, outcome.value); }
function renderComparison() {
  const selected = securities.filter((security) => comparedCodes.has(security.code));
  $("comparisonCount").textContent = `已选 ${selected.length} / 3`;
  if (selected.length === 0) { $("comparisonPanel").classList.add("hidden"); return; }
  $("comparisonPanel").classList.remove("hidden");
  if (selected.length === 1) {
    $("comparisonContent").innerHTML = `<p class="helper">再选择至少 1 个标的后，系统将只展示口径一致的事实差异与待核验问题。</p>`;
    return;
  }
  const metrics = [
    { label: "利润两年 CAGR", key: "growth", format: percent, period: "2Y" },
    { label: "PE-TTM", key: "pe", format: (value) => `${value.toFixed(1)}x`, period: "TTM" },
    { label: "60 日年化波动率", key: "volatility", format: percent, period: "60TD" }
  ];
  const tableRows = metrics.map((metric) => {
    const valid = selected.every((security) => security[metric.key] !== null && security.source === selected[0].source && security.asOf === selected[0].asOf);
    const cells = selected.map((security) => valid ? `<td>${metric.format(security[metric.key])}</td>` : `<td class="not-comparable">NOT_COMPARABLE<span class="mini">${security[metric.key] === null ? "数据缺失" : "存在不可比标的"}</span></td>`).join("");
    return `<tr><td><b>${metric.label}</b><span class="mini">${metric.period} · ${valid ? "同口径" : "不可比"}</span></td>${cells}</tr>`;
  }).join("");
  const questions = [];
  if (selected.some((security) => security.pe === null)) questions.push({ title: "补齐估值事实", text: "至少一只已选标的缺少 PE-TTM，无法完成估值比较；先核验该指标的可用报告期和数据源。" });
  if (selected.every((security) => security.pe !== null)) questions.push({ title: "核验估值差异", text: "已选标的均有同口径 PE-TTM；下一步可核验利润预期、报告期和一次性损益是否解释了估值差异。" });
  questions.push({ title: "核验增长持续性", text: "两年 CAGR 只描述历史区间；继续研究前，应查验对应报告期的利润构成和增长是否来自持续经营。" });
  $("comparisonContent").innerHTML = `<div class="table-wrap"><table class="comparison-table"><thead><tr><th>指标</th>${selected.map((security) => `<th>${security.name}<span class="mini">${security.code}</span></th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div><h3>基于事实的待研究问题</h3><div class="research-questions">${questions.map((question) => `<div class="research-question"><b>${question.title}</b>${question.text}</div>`).join("")}</div>`;
}
function openEvidence(code, trigger) {
  lastEvidenceTrigger = trigger || null;
  const security = securities.find((item) => item.code === code);
  const outcomes = conditions.map((condition) => ({ condition, outcome: resultFor(security, condition) }));
  $("drawerTitle").textContent = `${security.name} 的证据`;
  $("evidenceContent").innerHTML = outcomes.map(({ condition, outcome }) => {
    const target = outcome.target === undefined ? (typeof condition.value === "function" ? condition.value() : condition.value) : outcome.target;
    const display = outcome.value === null ? "数据缺失" : fmt(condition, outcome.value);
    const rule = outcome.value === null ? `无有效数值 -> ${outcome.state}` : `${display} ${condition.operator} ${fmt(condition, target)} -> ${outcome.state}`;
    const evidenceKey = condition.id === "valuation" ? "valuation" : condition.id === "stability" ? "stability" : "growth";
    const evidence = security.evidence?.[evidenceKey];
    const requestKey = condition.id === "valuation" ? "valuation" : condition.id === "stability" ? "prices" : "financials";
    const requestId = security.request_ids?.[requestKey] || "未返回";
    const retries = security.retry_counts?.[requestKey] || 0;
    return `<section class="evidence-item"><h3>${condition.name} · <span class="status ${statusClass(outcome.state)}">${outcome.state}</span></h3><p class="evidence-rule">${rule}</p><div class="evidence-grid"><div><span>原始值</span><b>${display}</b></div><div><span>统计口径</span><b>${evidence?.period || condition.period}</b></div><div><span>数据来源</span><b>${security.source}</b></div><div><span>数据时点</span><b>${security.asOf}</b></div><div><span>字段映射</span><b>${evidence?.field || "未返回"}</b></div><div><span>request_id / 重试</span><b>${requestId} / ${retries}</b></div></div></section>`;
  }).join("") + `<p class="boundary">证据来自扶摇真实接口；指数、估值、财务和行情均保留字段映射与 request_id。${apiMeta?.selection_note || ""}</p>`;
  $("evidenceDrawer").classList.remove("hidden"); $("backdrop").classList.remove("hidden");
}
function closeEvidence() { $("evidenceDrawer").classList.add("hidden"); $("backdrop").classList.add("hidden"); if (lastEvidenceTrigger) lastEvidenceTrigger.focus(); }
function parse() {
  const text = $("strategyInput").value.trim();
  if (!text) { $("inputMessage").textContent = "请先输入一段选股想法。"; return; }
  if (/必涨|买入|收益|推荐/.test(text)) { $("inputMessage").textContent = "本产品仅编译筛选策略，不生成涨跌预测、收益承诺或买卖建议。请描述可验证的筛选条件。"; return; }
  const parsed = parseIntent(text);
  syncConditions();
  strategyState = createStrategyState(text);
  strategyState.ambiguities = parsed.ambiguities;
  strategyState.status = parsed.conflict ? "CONFLICT" : parsed.unsupported ? "UNSUPPORTED" : parsed.ambiguities.length ? "NEEDS_CLARIFICATION" : "READY_TO_CONFIRM";
  strategyState.audit.push({ event: strategyState.status, at: new Date().toISOString(), ambiguities: parsed.ambiguities });
  renderConditions(); $("clarificationPanel").classList.remove("hidden");
  $("strategyStatus").textContent = strategyState.status === "CONFLICT" ? "条件冲突" : strategyState.status === "UNSUPPORTED" ? "不支持" : strategyState.status === "NEEDS_CLARIFICATION" ? "待澄清" : "待确认";
  $("strategyStatus").className = `status ${["UNSUPPORTED", "CONFLICT"].includes(strategyState.status) ? "fail" : "warning"}`;
  const note = parsed.ambiguities.length ? `已结构化解析。执行前请确认：${parsed.ambiguities.join("；")}` : "已结构化解析股票池和三项条件，建议阈值仍需由你确认。";
  $("inputMessage").textContent = note;
  setWorkflow(2); setHeaderVersion("草稿待确认"); $("clarificationPanel").scrollIntoView({ behavior: "smooth", block: "start" }); $("confirmButton").focus();
}
async function confirm() {
  if (strategyState?.status === "CONFLICT") {
    $("inputMessage").textContent = "CONFLICT：策略条件互相矛盾，已阻止执行。请修改冲突阈值后重新构建策略。";
    return;
  }
  if (strategyState?.status === "UNSUPPORTED") {
    $("inputMessage").textContent = "当前策略包含未支持的指标，已阻止执行。请删除未支持条件后重新构建策略。";
    return;
  }
  if (!strategyState) {
    $("inputMessage").textContent = "请先构建策略草稿。";
    return;
  }
  strategyState.status = "CONFIRMED";
  strategyState.audit.push({ event: "CONFIRMED", at: new Date().toISOString(), version: strategyState.version });
  $("clarificationPanel").classList.add("hidden"); $("resultsPanel").classList.remove("hidden");
  $("strategyStatus").textContent = "正在获取真实数据"; $("strategyStatus").className = "status warning"; setWorkflow(3); setHeaderVersion("真实数据加载中");
  $("resultRows").innerHTML = `<tr><td colspan="7" class="helper">正在获取沪深 300 成分、估值、财务和历史 K 线，请稍候...</td></tr>`;
  $("resultsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const query = new URLSearchParams({
      pe_max: String(threshold),
      growth_min: String(growthThreshold),
      volatility_max: String(volatilityThreshold),
    });
    const response = await fetch(`/api/screen?${query}`);
    const payload = await response.json();
    if (!response.ok || payload.status === "TOOL_ERROR") throw new Error(payload.message || "真实数据接口调用失败");
    securities = Array.isArray(payload.data) ? payload.data : [];
    apiMeta = payload;
    const fullCoverage = payload.mode === "FULL_SNAPSHOT" && payload.coverage_rate === 1;
    $("dataModeBadge").textContent = fullCoverage ? "真实数据 · 全量快照" : "真实数据 · 样本验证";
    $("universeTag").textContent = fullCoverage ? "沪深 300 全量" : "沪深 300 样本";
    $("evaluatedLabel").textContent = fullCoverage ? "完整评估" : "深度评估样本";
    strategyState.status = "RESULT_READY";
    strategyState.audit.push({ event: "RESULT_READY", at: new Date().toISOString(), request_id: payload.request_id, as_of: payload.as_of });
    const abnormal = ["STALE", "PARTIAL", "ZERO_RESULT"].includes(payload.status);
    $("strategyStatus").textContent = abnormal ? payload.status : "已执行"; $("strategyStatus").className = `status ${abnormal ? "warning" : "pass"}`; setHeaderVersion(`策略 v${version}`); renderResults();
  } catch (error) {
    securities = []; apiMeta = null;
    $("strategyStatus").textContent = "工具错误"; $("strategyStatus").className = "status fail"; setHeaderVersion("真实数据获取失败");
    $("resultSubtitle").textContent = `无法完成真实数据筛选：${error.message}`;
    $("resultRows").innerHTML = `<tr><td colspan="7" class="helper">TOOL_ERROR：${error.message}。请检查 Vercel 的 FUYAO_API_KEY 和接口状态；系统没有将失败转换为正常筛选结果。</td></tr>`;
    $("growthCount").textContent = "-"; $("valuationCount").textContent = "-"; $("candidateCount").textContent = "-";
    $("evaluatedCount").textContent = "-";
  }
}
function previewPatch() {
  const text = $("editInput").value.trim();
  const matched = text.match(/PE(?:-TTM)?\s*(?:改成|调整为|小于|<)\s*(\d+(?:\.\d+)?)/i);
  const growthMatch = text.match(/(?:利润增长|CAGR|增长率)\s*(?:改成|调整为|大于|超过|>)\s*(\d+(?:\.\d+)?)%/i);
  const volatilityMatch = text.match(/(?:波动率|波动)\s*(?:改成|调整为|小于|<)\s*(\d+(?:\.\d+)?)%/i);
  let patch = null;
  if (matched) patch = { path: "/conditions/1/value", label: "PE-TTM", oldValue: threshold, newValue: Number(matched[1]), field: "valuation" };
  else if (growthMatch) patch = { path: "/conditions/0/value", label: "利润 CAGR", oldValue: growthThreshold * 100, newValue: Number(growthMatch[1]), field: "growth" };
  else if (volatilityMatch) patch = { path: "/conditions/2/value", label: "60 日波动率", oldValue: volatilityThreshold * 100, newValue: Number(volatilityMatch[1]), field: "stability" };
  if (!patch) { $("patchPreview").innerHTML = `<p>未识别到可执行修改。支持“PE 改成 20”“利润增长率改成 15%”“波动率改成 25%”。</p>`; $("patchPreview").classList.remove("hidden"); return; }
  const audit = { op: "replace", path: patch.path, old_value: patch.oldValue, value: patch.newValue, base_version: version, strategy_id: strategyState?.strategy_id || "未创建", at: new Date().toISOString() };
  const auditHash = btoa(JSON.stringify(audit)).slice(0, 16);
  $("patchPreview").innerHTML = `<p><b>Patch 预览</b> <span class="tag">${auditHash}</span></p><p>${patch.label}：<span class="patch-old">${patch.oldValue}${patch.field === "valuation" ? "x" : "%"}</span> <span class="patch-new">${patch.newValue}${patch.field === "valuation" ? "x" : "%"}</span></p><p>仅修改 <code>${patch.path}</code>，其余条件保持不变。确认后生成策略 v${version + 1} 并重新筛选。</p><div class="patch-actions"><button id="applyPatch" class="primary" type="button">确认修改并重新执行</button><button id="cancelPatch" class="text-action" type="button">取消</button></div>`;
  $("patchPreview").classList.remove("hidden");
  setWorkflow(4);
  $("applyPatch").addEventListener("click", () => {
    if (strategyState && strategyState.version !== audit.base_version) {
      strategyState.status = "CONFLICT";
      $("patchPreview").innerHTML = `<p><b>CONFLICT</b>：当前策略已从 v${audit.base_version} 变更为 v${strategyState.version}，请重新生成 Patch。</p>`;
      return;
    }
    if (patch.field === "valuation") threshold = patch.newValue;
    if (patch.field === "growth") growthThreshold = patch.newValue / 100;
    if (patch.field === "stability") volatilityThreshold = patch.newValue / 100;
    version += 1; syncConditions();
    if (strategyState) {
      strategyState.version = version; strategyState.status = "REVALIDATING"; strategyState.conditions = conditions.map((condition) => ({ id: condition.id, metric: condition.metric, operator: condition.operator, value: typeof condition.value === "function" ? condition.value() : condition.value, unit: condition.unit, period: condition.period, status: "PROPOSED" }));
      strategyState.audit.push({ event: "PATCH_CONFIRMED", at: new Date().toISOString(), patch: audit, patch_hash: auditHash, version });
    }
    $("patchPreview").classList.add("hidden"); setWorkflow(3); setHeaderVersion(`策略 v${version}`); renderConditions(); void confirm();
  });
  $("cancelPatch").addEventListener("click", () => $("patchPreview").classList.add("hidden"));
}
$("exampleButton").addEventListener("click", () => { $("strategyInput").value = example; $("strategyInput").focus(); });
$("parseButton").addEventListener("click", parse); $("confirmButton").addEventListener("click", confirm); $("previewButton").addEventListener("click", previewPatch); $("closeDrawer").addEventListener("click", closeEvidence); $("backdrop").addEventListener("click", closeEvidence);
