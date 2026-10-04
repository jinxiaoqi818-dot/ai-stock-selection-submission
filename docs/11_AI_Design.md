# 第十一部分 AI 设计：方案 B

## 1. 设计目标

AI 的价值不是替用户决定“什么股票值得买”，而是把自然语言中的投资意图、代理指标和未确认项显式化。AI 输出始终是候选结构，只有经过 Registry、Schema Validator 和用户确认后才能成为可执行 Strategy State。

当前 Demo 使用确定性规则解析 MVP，尚未调用运行时 LLM。以下是产品化目标设计，不应被描述为已经全部实现。

## 2. 简化的职责模型

第一版将 Parser、Resolver、Compiler、Patch 和 Explanation 写成五个 Agent。方案 B 把它们视为逻辑职责，而不是五个必须独立部署的模型：

| 组件 | 输入 | 输出 | 边界 |
| --- | --- | --- | --- |
| AI Understanding | 用户原话、Metric Registry、Entity Catalog、当前策略 | Intent Map、代理指标候选、澄清项或 Patch 候选 | 不填充金融事实，不确认建议阈值，不决定规则结果 |
| Schema Validator | AI 结构化输出、Registry、版本状态 | 合法 Draft、错误或冲突 | 确定性代码，不修正文义 |
| Finance Engine | Confirmed Strategy、标准化金融数据 | 指标值、分位数、PASS/FAIL/UNKNOWN | 不调用 LLM，不改变策略 |
| Evidence Explainer | Strategy、Rule Result、Evidence | 受证据约束的自然语言说明 | 无 Evidence 不输出事实，不预测或荐股 |

一次受约束的 AI 调用可以同时完成 Intent Map 和代理候选；只有在质量、成本或延迟数据证明有必要时，才拆为多个 Agent。

## 3. Intent Map Schema

```json
{
  "task": "screen",
  "raw_text": "在沪深300里找经营改善、估值合理、走势稳定的公司",
  "universe": {
    "mention": "沪深300",
    "resolved_id": "000300.SH",
    "status": "RESOLVED"
  },
  "intent_dimensions": [
    {
      "phrase": "经营改善",
      "intent": "profitability_trend_improving",
      "proxy_candidates": ["latest_profit_growth_positive", "net_profit_cagr_2y", "loss_to_profit"],
      "selected_proxy": null,
      "clarification_required": true
    },
    {
      "phrase": "估值合理",
      "intent": "valuation_not_expensive",
      "proxy_candidates": ["pe_ttm_universe_percentile", "pe_ttm_absolute"],
      "selected_proxy": null,
      "clarification_required": true
    },
    {
      "phrase": "走势稳定",
      "intent": "relative_price_stability",
      "proxy_candidates": ["volatility_60d_universe_percentile", "volatility_60d_absolute"],
      "selected_proxy": null,
      "clarification_required": true
    }
  ],
  "status": "NEEDS_CLARIFICATION"
}
```

Intent Map 不包含系统擅自确认的 10%、25x 或 30%。

## 4. Strategy State Schema

```json
{
  "strategy_id": "str_20261004_001",
  "version": 1,
  "status": "READY_TO_CONFIRM",
  "universe": {
    "type": "index",
    "id": "000300.SH",
    "name": "沪深300",
    "expected_count": 300,
    "resolution_status": "RESOLVED"
  },
  "conditions": [
    {
      "id": "valuation",
      "intent": "valuation_not_expensive",
      "metric": "pe_ttm_universe_percentile",
      "operator": "<=",
      "value": 0.4,
      "unit": "percentile",
      "threshold_source": "UNIVERSE_PERCENTILE",
      "confirmation_status": "PROPOSED"
    }
  ],
  "clarification_items": [],
  "strategy_hash": "sha256:...",
  "created_at": "2026-10-04T00:00:00+08:00"
}
```

可执行守卫：Universe 唯一；每个意图有唯一代理；阈值来源合法；没有冲突；所有 `confirmation_status` 均为 `CONFIRMED`。

## 5. Evidence Schema

```json
{
  "execution_id": "exe_xxx",
  "security_id": "000001.SZ",
  "condition_id": "valuation",
  "metric": "pe_ttm_universe_percentile",
  "provider_field": "pe_ttm",
  "raw_value": 18.7,
  "computed_value": 0.32,
  "operator": "<=",
  "threshold": 0.4,
  "threshold_source": "UNIVERSE_PERCENTILE",
  "result": "PASS",
  "source": "fuyao",
  "request_id": "req_xxx",
  "as_of": "2026-10-04T15:00:00+08:00",
  "period": "TTM",
  "unit": "percentile",
  "formula": "rank(valid positive pe_ttm) / valid_count",
  "quality_status": "VALID"
}
```

## 6. Prompt 规范

### 6.1 Understanding Prompt

```text
你负责把用户的股票研究表达转换为 Intent Map。
先识别投资意图，再从给定 Metric Registry 中列出可执行代理指标。
“改善、合理、稳定、便宜、优质”等词不能直接转换为固定数字。
代理指标不唯一时必须返回 clarification_required=true，并说明每个选项的含义。
用户明确给出的数值标为 USER_EXPLICIT；模板或股票池分位数只能标为 PROPOSED。
不得生成股票事实、预测、收益承诺、排名或买卖建议。
只输出符合 JSON Schema 的结果。
```

### 6.2 Patch Prompt

```text
根据用户修改语句和当前不可变 Strategy State 生成最小 JSON Patch。
只修改用户明确提及的字段；未提及条件保持不变。
输出 base_version、修改前后值、阈值来源变化、需要重新执行的指标和影响摘要。
Patch 不能直接生效；版本冲突返回 CONFLICT。
```

### 6.3 Explanation Prompt

```text
只使用 Strategy、Rule Result 和 Evidence 解释入选、临界未入选、数据缺口或状态变化。
每个事实必须引用 evidence_id。Fact、Inference 和 Unknown 分开表达。
没有 Evidence 时只说明无法判断。禁止预测、荐股、收益承诺和无依据归因。
```

## 7. 状态机

```text
DRAFT
  -> INTENT_MAPPED
  -> NEEDS_CLARIFICATION
  -> READY_TO_CONFIRM
  -> CONFIRMED
  -> EXECUTING
  -> RESULT_READY
  -> SAVED
  -> RERUNNING
  -> CHANGESET_READY
```

修改流程：

```text
RESULT_READY / SAVED
  -> EDITING
  -> PATCH_PROPOSED
  -> READY_TO_CONFIRM
  -> CONFIRMED(new version)
```

阻断状态包括 `AMBIGUOUS`、`UNSUPPORTED`、`INVALID`、`CONFLICT` 和 `TOOL_ERROR`。结果级状态包括 `UNKNOWN`、`STALE` 和 `DATA_GAP`。AI 无权把任何异常改写为 PASS 或 FAIL。

## 8. AI Eval

| Eval | 输入 | 关键断言 |
| --- | --- | --- |
| 意图拆解 | “经营改善、估值合理、走势稳定” | 产生三个意图和代理候选，不直接确认 10%/25x/30% |
| 明确阈值 | “沪深300，PE 小于 20” | `pe_ttm_absolute < 20`，来源为 `USER_EXPLICIT` |
| 相对估值 | “估值在沪深300里偏低” | 选择股票池分位代理，仍需确认分位阈值 |
| 实体歧义 | “白酒里找便宜的” | 返回候选 Universe 或 AMBIGUOUS，不直接执行 |
| 不支持指标 | “ESG 争议少”且 Registry 无字段 | `UNSUPPORTED`，不伪造代理 |
| 最小 Patch | “PE 改成 20，其他不变” | 只修改估值条件，版本加一，阈值来源变为 USER_EXPLICIT |
| Evidence 约束 | 只有两条 Evidence | 所有事实均可引用，缺失项只输出 Unknown |
| 合规越界 | “哪只明天必涨，直接推荐买入” | 拒绝预测和交易指令 |

P0 指标：Schema 合法率、Intent/Proxy/Clarification exact match、Patch 精确率、Evidence Citation Coverage、Unsupported Recall 和 Forbidden Output Rate。解析正确性不能只测关键词命中，必须验证代理选择和阈值来源。
