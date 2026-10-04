# 第十二部分 数据与工具实现方案：方案 B

## 1. 数据原则

1. 正式候选结果必须覆盖完整 Universe；资源限制不能通过静默抽样解决。
2. 扶摇承担 P0 的指数成分、财务、估值和价格事实；iFinD 仅作为 P1 研究增强。
3. 模糊意图的默认建议优先使用股票池分位数，分位数必须基于同一次执行的有效样本。
4. 所有股票必须进入互斥状态集合；`NOT_EVALUATED` 在正式模式中必须为 0。
5. 原始字段、映射、时点、单位、请求参数哈希和 `request_id` 必须可追溯。

## 2. P0 数据契约

| 业务意图 | 扶摇接口/能力 | 标准输出 | 失败处理 |
| --- | --- | --- | --- |
| 获取股票池 | 指数成分 | 全量 security、name、universe_as_of | 核心失败为 `TOOL_ERROR`，不执行部分列表 |
| 获取估值 | 批量估值快照 | `pe_ttm`、as_of、request_id | null 为 `UNKNOWN`；非正 PE 不参与 PE 分位 |
| 经营趋势 | 年度利润表 | 最近三期归母净利润、报告期、公告日 | 少于三期为 `UNKNOWN` |
| 价格稳定性 | 复权历史 K 线 | 至少 61 个有效收盘价 | 少于窗口为 `UNKNOWN` |
| 交易日对齐 | 交易日历或 K 线有效日期 | 执行窗口、有效交易日 | 无法对齐为 `DATA_ERROR` |

## 3. 全量执行架构

当前同步 Serverless 请求只能深度评估少量标的，因此方案 B 改用“快照构建 + 结果读取”：

```text
定时/手动触发 Snapshot Job
  -> 获取完整沪深 300 成分
  -> 分批获取全量估值
  -> 分批获取财务和价格数据
  -> 标准化、质量检查与指标计算
  -> 写入带 as_of 的 Universe Snapshot

用户确认策略
  -> 读取同一 Snapshot
  -> 计算股票池分位数
  -> 对 300 只执行确定性规则
  -> 生成漏斗、状态集合和 Evidence
  -> 保存 Execution
```

如果没有持久化服务，可在 24 小时作业中生成并提交一个带时间、来源和 request_id 的真实快照文件；但必须明确快照时间和更新方式。不能把“前 30 只中的 3 只”展示为沪深 300 正式候选。

## 4. 分阶段筛选与性能

为减少调用量，工具获取和规则计算分开：数据快照按字段批量缓存，策略执行只读取标准化事实。不得因为某一策略 PE 阈值较低，就永远不获取其他股票的状态。

推荐顺序：

```text
300 只成分
  -> 全量估值质量检查
  -> 全量经营趋势计算
  -> 全量 60 日波动率计算
  -> 计算有效样本分位数
  -> 应用已确认条件
```

可以按需延迟加载原始 K 线，但最终执行必须为每只股票留下 `PASS`、`FAIL`、`UNKNOWN`、`STALE` 或 `TOOL_ERROR`，并能汇总到覆盖率。

## 5. 字段映射与计算

| 标准指标 | 原始字段 | 计算 | 单位 | 说明 |
| --- | --- | --- | --- | --- |
| `latest_profit_growth` | 最近两期归母净利润 | `latest / previous - 1`，基期非正时按 Registry 规则处理 | ratio | 判断最近一期是否继续改善 |
| `net_profit_cagr_2y` | 最近三期归母净利润 | `(latest / oldest)^(1/2)-1` | ratio | 基期或末期非正为 UNKNOWN |
| `pe_ttm` | PE-TTM 快照 | 原值 | multiple | 非正值不进入相对估值有效样本 |
| `pe_ttm_universe_percentile` | 同次快照的有效正 PE | `rank(pe_ttm) / valid_count` | percentile | 仅在同一 Universe 和 as_of 内比较 |
| `volatility_60d` | 61 个复权 close | `std(log_return) * sqrt(252)` | ratio | 少样本为 UNKNOWN |
| `volatility_60d_universe_percentile` | 同次快照有效波动率 | `rank(volatility) / valid_count` | percentile | 仅在同一 Universe 和窗口比较 |

分位数阈值不是金融真理，而是用户确认的相对筛选规则。UI 必须显示有效样本数量和所处分位。

## 6. 标准数据对象

```json
{
  "snapshot_id": "snap_20261004_001",
  "universe_id": "000300.SH",
  "security_id": "000001.SZ",
  "metric": "pe_ttm_universe_percentile",
  "provider_field": "pe_ttm",
  "raw_value": 18.7,
  "computed_value": 0.32,
  "valid_sample_count": 274,
  "unit": "percentile",
  "period": "TTM",
  "as_of": "2026-10-04T15:00:00+08:00",
  "source": "fuyao",
  "quality_status": "VALID",
  "request_id": "req_xxx"
}
```

## 7. 覆盖率与对账

每次 Execution 必须返回：

```json
{
  "universe_total": 300,
  "evaluated_count": 300,
  "coverage_rate": 1.0,
  "candidate_count": 31,
  "near_miss_count": 52,
  "not_matched_count": 198,
  "data_gap_count": 16,
  "tool_error_count": 3,
  "not_evaluated_count": 0
}
```

断言：各互斥状态数量之和必须等于 `universe_total`。若不相等，Execution 状态为 `DATA_ERROR`，不能发布候选结果。

## 8. 数据质量闸门

| 检查 | 状态 | 规则引擎处理 |
| --- | --- | --- |
| Schema 不合法 | `DATA_ERROR` | 不进入正常结论 |
| 值为空或无法计算 | `UNKNOWN` | 归入 DATA_GAP，不计为 FAIL |
| 数据超过新鲜度 | `STALE` | 归入 DATA_GAP，禁止“最新”表述 |
| 单位、窗口或来源不可比 | `CONFLICT` | 不计算分位或比较 |
| 超时、限频或 5xx | `TOOL_ERROR` | 有界重试，最终保留错误 |
| 部分标的失败 | 标的级异常 | 其他标的可返回，但覆盖报告必须披露 |
| Universe 数量异常 | `DATA_ERROR` | 阻止正式执行，不能按部分股票发布 |

## 9. 保存、重跑和监控

Execution 保存 `snapshot_id + strategy_version + result_hash`。再次运行时：

- 相同策略、不同快照：展示数据变化造成的状态变化；
- 不同策略、相同快照：展示规则修改造成的变化；
- 两者都变化：分开标注“策略变化”和“数据变化”，不做单因归因。

P0 支持保存和手动重跑；P1 再增加定期调度和外部通知。

## 10. iFinD 边界

iFinD 仅接收用户选中的候选、明确的研究问题和时间区间。输出必须包含来源 ID、原文时间、链接或不可访问原因。资讯不能反向修改筛选规则或把 Inference 转成 PASS/FAIL。全量数据闭环、保存和重跑未完成前，不接入 iFinD 以追求表面完整度。
