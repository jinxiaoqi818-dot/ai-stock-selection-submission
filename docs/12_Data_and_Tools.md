# 第十二部分 数据与工具实现方案

## 1. 原则

扶摇承担 P0 的结构化事实与主筛选链路；iFinD 用于按需研究增强。Tool 名称、参数和响应字段必须在部署环境中从 MCP Tool Catalog 或官方 API 契约读取后登记，不能把公开能力描述当作已验证的线上接口。

下表中“候选能力名”只是适配器意图，不是可直接调用的固定 Tool 名。

## 2. Tool Mapping

| 业务意图 | 首选来源 | 候选能力名 | 输入 | 标准输出 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| 解析指数 | 扶摇 | `index_search` | 名称或代码 | `universe_id`、名称、市场 | `AMBIGUOUS` / `NOT_FOUND` |
| 获取成分股 | 扶摇 | `index_constituents` | 指数 ID、交易日 | security 列表、as_of | 核心失败为 `TOOL_ERROR` |
| 交易日对齐 | 扶摇 | `trading_calendar` | 市场、区间 | 有效交易日 | 无交易日为 `DATA_ERROR` |
| 财务多期数据 | 扶摇 | `financial_statements` 或 `financial_indicators` | security、报告期 | 原始值、period、公告日 | 缺期为 `UNKNOWN` |
| 当前估值 | 扶摇 | `valuation_snapshot` | security、as_of | PE-TTM、单位、时间 | null 为 `UNKNOWN` |
| 历史价格 | 扶摇 | `historical_kline` | security、起止日、复权口径 | close 序列、trade_date | 少于窗口为 `UNKNOWN` |
| 行情快照 | 扶摇 | `price_snapshot` | security 列表 | latest price、trade_date | 仅展示层可降级 |
| 事件/资讯研究 | iFinD | runtime catalog 中的 news/event/policy tool | security/行业、时间范围 | 原文、来源、时间、ID | 局部 `TOOL_ERROR`，不影响筛选 |

## 3. 调用顺序

```text
确认 Strategy State
  -> 校验 Metric Registry 与时间口径
  -> Universe Adapter: 实体检索 / 成分股
  -> Calendar Adapter: 确定交易窗口
  -> Batch Data Adapter: 财务、估值、历史价格
  -> Data Quality Gate
  -> Calculation Engine: CAGR、年化波动率
  -> Rule Engine: PASS / FAIL / UNKNOWN
  -> Evidence Builder
  -> 可选 iFinD Research Adapter
  -> Explanation Agent
```

批量请求按工具限频、最大标的数和时间范围切片。每一个 request 应写入 `request_id`、Tool 版本、参数哈希、开始/结束时间和结果状态；不记录密钥或用户敏感文本。

## 4. 字段映射与计算

| 标准指标 | 原始字段要求 | 计算 | 单位 | 时间口径 | 新鲜度 |
| --- | --- | --- | --- | --- | --- |
| `net_profit_cagr` | 同一口径的两期归母净利润 | `(end/start)^(1/years)-1` | ratio | FY / 报告期 | 财报发布后有效 |
| `pe_ttm` | 估值快照 PE-TTM | 原样使用 | x | as_of | 当交易日收盘后 |
| `volatility_60d` | 至少 60 个有效 close | `std(log_return) * sqrt(annualization_days)` | ratio | 60 交易日 | 当交易日收盘后 |
| `roe` | 财务指标 ROE | 原样使用，需确认平均/期末口径 | ratio | 报告期 | 财报发布后有效 |

约束：CAGR 的起点小于等于零时不计算；不同复权口径不得混合；TTM、MRQ、FY 不可直接比较；货币单位必须标准化或同时展示原单位。真实字段名由 `provider_field` 映射表在接入时填写，所有上游原字段保存在 raw payload 的受控日志中。

## 5. 统一数据对象

```json
{
  "security_id": "000001.SZ",
  "metric": "pe_ttm",
  "value": 18.7,
  "unit": "x",
  "period": "TTM",
  "as_of": "2026-10-02T15:00:00+08:00",
  "source": "fuyao",
  "provider_field": "RUNTIME_VERIFIED_FIELD",
  "quality_status": "VALID",
  "request_id": "req_xxx"
}
```

## 6. 数据质量闸门

| 检查 | 失败状态 | 前端语义 | 规则引擎处理 |
| --- | --- | --- | --- |
| 响应 Schema 不合法 | `DATA_ERROR` | 数据格式异常 | 条件为 Unknown |
| 值为空/无法计算 | `UNKNOWN` | 数据缺失 | 不计为 Fail |
| 数据时间过期 | `STALE` | 数据不是当前口径 | 禁止“最新”结论 |
| 单位/期间不兼容 | `CONFLICT` | 口径冲突 | 不比较、不自动转换 |
| 调用超时/限频/5xx | `TOOL_ERROR` | 数据工具暂不可用 | 允许重试，保留错误码 |
| 部分标的失败 | 每标的独立状态 | 个别标的未知 | 不能降低到 Fail |

重试仅针对网络超时、临时 5xx 和明确的限频响应，采用指数退避并有最大次数。401/403、请求参数错误和契约不匹配不重试，直接记录配置或实现错误。

## 7. iFinD 研究增强

iFinD 的调用是结果页“进一步研究”，与 P0 筛选分层。输入只能使用用户选中的候选标的、已确认行业/主题和明确时间区间；输出必须保留原文链接或可追溯 ID、发布时间、数据源和抓取时间。新闻或政策文字属于 Fact；“可能影响”属于 Inference，需由 Explanation Agent 明示不确定性，不能转换为买卖结论。
