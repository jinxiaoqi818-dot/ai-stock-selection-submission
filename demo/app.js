const example = "在沪深300里找近两年利润增长较快、PE不要太高、走势比较稳定的公司。";
let threshold = 25;
let version = 1;
const comparedCodes = new Set();
let lastEvidenceTrigger = null;
let securities = [];
let apiMeta = null;

const conditions = [
  { id: "growth", name: "利润增长", metric: "归母净利润两年 CAGR", detail: "建议阈值：大于 10%", operator: ">", value: 0.10, unit: "%", period: "2Y" },
  { id: "valuation", name: "估值", metric: "PE-TTM", detail: "建议阈值：小于 25x", operator: "<", value: () => threshold, unit: "x", period: "TTM" },
  { id: "stability", name: "走势稳定性", metric: "60 日年化波动率", detail: "建议阈值：小于 30%", operator: "<", value: 0.30, unit: "%", period: "60TD" }
];

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
  if (security.checks && security.checks[checkKey] === "TOOL_ERROR") return { state: "TOOL_ERROR", value, reason: "真实数据工具调用失败" };
  if (value === null || value === undefined) return { state: "UNKNOWN", value, reason: "该指标数据缺失，无法判断" };
  const target = typeof condition.value === "function" ? condition.value() : condition.value;
  const pass = condition.operator === ">" ? value > target : value < target;
  return { state: pass ? "PASS" : "FAIL", value, target, reason: pass ? "满足已确认条件" : "未满足已确认条件" };
}
function overall(security) {
  const states = conditions.map((condition) => resultFor(security, condition).state);
  if (states.includes("TOOL_ERROR")) return "TOOL_ERROR";
  return states.includes("UNKNOWN") ? "UNKNOWN" : states.every((state) => state === "PASS") ? "PASS" : "FAIL";
}
function statusClass(state) { return state === "PASS" ? "pass" : state === "FAIL" ? "fail" : state === "TOOL_ERROR" ? "fail" : "unknown"; }
function statusText(state) { return state === "PASS" ? "符合" : state === "FAIL" ? "不符合" : state === "TOOL_ERROR" ? "工具错误" : "未知"; }
function renderConditions() {
  $("conditionList").innerHTML = conditions.map((condition, i) => {
    const target = typeof condition.value === "function" ? condition.value() : condition.value;
    return `<div class="condition"><span class="condition-index">0${i + 1}</span><div><div class="condition-name">${condition.name} · ${condition.metric}</div><div class="condition-detail">${condition.detail}</div></div><span class="condition-value">${condition.operator} ${fmt(condition, target)}</span><span class="condition-state">待确认</span></div>`;
  }).join("");
}
function renderResults() {
  const rows = securities.map((security) => {
    const outcomes = conditions.map((condition) => resultFor(security, condition));
    const state = overall(security);
    const selected = comparedCodes.has(security.code);
    const disabled = comparedCodes.size >= 3 && !selected ? "disabled" : "";
    return `<tr><td class="security">${security.name}<span>${security.code}</span></td>${outcomes.map((outcome, index) => `<td><span class="status ${statusClass(outcome.state)}">${outcome.state}</span><span class="mini">${outcome.value === null ? "数据缺失" : conditionValue(outcome, conditions[index])}</span></td>`).join("")}<td><span class="status ${statusClass(state)}">${statusText(state)}</span></td><td><label class="compare-choice"><input class="compare-input" type="checkbox" data-code="${security.code}" ${selected ? "checked" : ""} ${disabled} /><span>加入对比</span></label></td><td><button class="evidence-button" data-code="${security.code}" type="button">查看证据</button></td></tr>`;
  }).join("");
  $("resultRows").innerHTML = rows;
  const growthPass = securities.filter(s => resultFor(s, conditions[0]).state === "PASS").length;
  const valPassAfterGrowth = securities.filter(s => resultFor(s, conditions[0]).state === "PASS" && resultFor(s, conditions[1]).state === "PASS").length;
  const candidates = securities.filter(s => overall(s) === "PASS").length;
  $("growthCount").textContent = growthPass;
  $("valuationCount").textContent = valPassAfterGrowth;
  $("candidateCount").textContent = candidates;
  $("versionTag").textContent = `策略 v${version}`;
  const metaText = apiMeta ? `真实数据：${apiMeta.evaluated_count}/${apiMeta.universe_total} 只已评估；${apiMeta.selection_note || ""}` : "";
  $("resultSubtitle").textContent = `已确认：利润 CAGR > 10%，PE-TTM < ${threshold}x，60 日波动率 < 30%。${metaText}`;
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
    return `<section class="evidence-item"><h3>${condition.name} · <span class="status ${statusClass(outcome.state)}">${outcome.state}</span></h3><p class="evidence-rule">${rule}</p><div class="evidence-grid"><div><span>原始值</span><b>${display}</b></div><div><span>统计口径</span><b>${evidence?.period || condition.period}</b></div><div><span>数据来源</span><b>${security.source}</b></div><div><span>数据时点</span><b>${security.asOf}</b></div><div><span>字段映射</span><b>${evidence?.field || "未返回"}</b></div><div><span>request_id</span><b>${requestId}</b></div></div></section>`;
  }).join("") + `<p class="boundary">证据来自扶摇真实接口；指数、估值、财务和行情均保留字段映射与 request_id。${apiMeta?.selection_note || ""}</p>`;
  $("evidenceDrawer").classList.remove("hidden"); $("backdrop").classList.remove("hidden");
}
function closeEvidence() { $("evidenceDrawer").classList.add("hidden"); $("backdrop").classList.add("hidden"); if (lastEvidenceTrigger) lastEvidenceTrigger.focus(); }
function parse() {
  const text = $("strategyInput").value.trim();
  if (!text) { $("inputMessage").textContent = "请先输入一段选股想法。"; return; }
  if (/必涨|买入|收益|推荐/.test(text)) { $("inputMessage").textContent = "本产品仅编译筛选策略，不生成涨跌预测、收益承诺或买卖建议。请描述可验证的筛选条件。"; return; }
  renderConditions(); $("clarificationPanel").classList.remove("hidden"); $("strategyStatus").textContent = "待确认"; $("strategyStatus").className = "status warning"; $("inputMessage").textContent = "已提取股票池和三项条件；建议阈值仍需由你确认。"; setWorkflow(2); setHeaderVersion("草稿待确认"); $("clarificationPanel").scrollIntoView({ behavior: "smooth", block: "start" }); $("confirmButton").focus();
}
async function confirm() {
  $("clarificationPanel").classList.add("hidden"); $("resultsPanel").classList.remove("hidden");
  $("strategyStatus").textContent = "正在获取真实数据"; $("strategyStatus").className = "status warning"; setWorkflow(3); setHeaderVersion("真实数据加载中");
  $("resultRows").innerHTML = `<tr><td colspan="7" class="helper">正在获取沪深 300 成分、估值、财务和历史 K 线，请稍候...</td></tr>`;
  $("resultsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const response = await fetch("/api/screen");
    const payload = await response.json();
    if (!response.ok || payload.status === "TOOL_ERROR") throw new Error(payload.message || "真实数据接口调用失败");
    securities = Array.isArray(payload.data) ? payload.data : [];
    apiMeta = payload;
    $("strategyStatus").textContent = "已执行"; $("strategyStatus").className = "status pass"; setHeaderVersion(`策略 v${version}`); renderResults();
  } catch (error) {
    securities = []; apiMeta = null;
    $("strategyStatus").textContent = "工具错误"; $("strategyStatus").className = "status fail"; setHeaderVersion("真实数据获取失败");
    $("resultSubtitle").textContent = `无法完成真实数据筛选：${error.message}`;
    $("resultRows").innerHTML = `<tr><td colspan="7" class="helper">TOOL_ERROR：${error.message}。请检查 Vercel 的 FUYAO_API_KEY 和接口状态。</td></tr>`;
    $("growthCount").textContent = "-"; $("valuationCount").textContent = "-"; $("candidateCount").textContent = "-";
  }
}
function previewPatch() {
  const text = $("editInput").value; const matched = text.match(/PE\s*(?:改成|小于|<)\s*(\d+)/i);
  if (!matched) { $("patchPreview").innerHTML = `<p>未识别到可执行的 PE 修改。请使用“把 PE 改成 20，其他不变”。</p>`; $("patchPreview").classList.remove("hidden"); return; }
  const next = Number(matched[1]);
  $("patchPreview").innerHTML = `<p><b>Patch 预览</b></p><p>估值条件：<span class="patch-old">PE-TTM &lt; ${threshold}x</span> <span class="patch-new">PE-TTM &lt; ${next}x</span></p><p>其余两个条件保持不变。确认后生成策略 v${version + 1} 并重新筛选。</p><div class="patch-actions"><button id="applyPatch" class="primary" type="button" data-next="${next}">确认修改并重新执行</button><button id="cancelPatch" class="text-action" type="button">取消</button></div>`;
  $("patchPreview").classList.remove("hidden");
  setWorkflow(4);
  $("applyPatch").addEventListener("click", (event) => { threshold = Number(event.currentTarget.dataset.next); version += 1; $("patchPreview").classList.add("hidden"); setWorkflow(3); setHeaderVersion(`策略 v${version}`); renderConditions(); renderResults(); });
  $("cancelPatch").addEventListener("click", () => $("patchPreview").classList.add("hidden"));
}
$("exampleButton").addEventListener("click", () => { $("strategyInput").value = example; $("strategyInput").focus(); });
$("parseButton").addEventListener("click", parse); $("confirmButton").addEventListener("click", confirm); $("previewButton").addEventListener("click", previewPatch); $("closeDrawer").addEventListener("click", closeEvidence); $("backdrop").addEventListener("click", closeEvidence);
