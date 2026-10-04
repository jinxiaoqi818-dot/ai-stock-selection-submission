# 第十四部分 技术实现与开发拆解

## 1. 目标架构

```text
Web UI
  -> Application API
      -> Strategy Service / Version Store
      -> AI Orchestrator
      -> Tool Router
          -> Fuyao Adapter
          -> iFinD Adapter
      -> Data Quality Gate
      -> Calculation Engine
      -> Rule Engine
      -> Evidence Builder
```

所有持久化对象以 `strategy_id`、`version` 和 `execution_id` 关联。Adapter 层把外部字段映射为内部标准对象，外部原始响应不得直接进入 UI 规则判断。

## 2. 模块与任务

| 模块 | 任务 | 优先级 | Definition of Done |
| --- | --- | --- | --- |
| types | Strategy、Condition、Evidence、Result、Error Schema | P0 | 运行时校验与静态类型一致 |
| metric registry | 指标字典、单位、公式、数据需求、新鲜度 | P0 | Compiler 只能选择 Registry 项 |
| strategy service | 创建版本、确认、Patch、审计日志 | P0 | 原版本不可被覆写 |
| ai service | Parser、Resolver、Compiler、Patch、Explanation | P0 | JSON Schema 强校验和 fallback |
| fuyao adapter | catalog 探测、请求、字段映射、批量/限频 | P0 | 实际 Tool Contract 测试通过 |
| quality engine | null、单位、时间、冲突、错误归类 | P0 | 不正常化异常 |
| finance engine | CAGR、收益率、波动率、窗口校验 | P0 | 单元测试覆盖边界 |
| rule engine | PASS/FAIL/UNKNOWN 和漏斗统计 | P0 | 不依赖 LLM |
| evidence builder | 规则结果到 Evidence Object | P0 | Evidence 字段完整率 100% |
| research handoff | 最多 3 个候选的同口径事实对比、数据缺口与研究问题 | P0 | 不可比字段标 `NOT_COMPARABLE`；每个研究问题关联 Evidence ID |
| iFind adapter | 研究增强、溯源和缓存 | P1 | 仅在 G0-G2 通过后接入；不影响 P0 主筛选 |
| frontend | 输入、确认、结果、抽屉、Patch、候选对比 | P0 | 20 名用户中至少 14 名可完成策略到候选对比的主链路 |
| cost telemetry | 按 execution_id 归集 Token、Tool、计算与存储成本 | P0 | 50 次真实执行可计算每次成功执行成本，P95 <= RMB 2.00 |

## 3. API 草案

| Endpoint | 方法 | 请求 | 响应 |
| --- | --- | --- | --- |
| `/strategies/parse` | POST | `text`, `context` | Intent、实体候选、草稿、澄清项 |
| `/strategies` | POST | 已校验草稿 | strategy_id、version、status |
| `/strategies/:id/confirm` | POST | version、hash | CONFIRMED version |
| `/strategies/:id/executions` | POST | version、as_of | execution_id、progress |
| `/executions/:id` | GET | - | 漏斗、结果、状态 |
| `/results/:id/evidence` | GET | security_id、condition_id | Evidence 对象 |
| `/strategies/:id/patches` | POST | version、edit_text | Patch、diff、需澄清项 |
| `/patches/:id/confirm` | POST | patch_hash | 新版本 |

## 4. 实现顺序

1. 先用固定沪深 300 策略验证扶摇 Tool Catalog、字段映射、批量取数和 Evidence，完成 G0。
2. 固定 Type、Metric Registry、状态机、Calculation 与 Rule Engine，并为边界编写测试。
3. 实现结构化 AI 调用、确认和 Patch，所有输出先经过 Schema Validator。
4. 实现前端主流程、候选对比和错误状态，进行 G2 用户任务测试。
5. G0-G2 全部通过后，再评估 iFinD 研究页；最后完成 Eval、成本日志、README、部署和演示录制。

## 5. 24 小时拆解

| 时间 | 产出 |
| --- | --- |
| 0-4h | 固定策略的扶摇 Tool Contract 验证、字段映射与 G0 日志 |
| 4-8h | Schema、数据质量、财务/行情计算、Rule Engine、Evidence |
| 8-12h | Parser、Resolver、Compiler、确认与 Patch |
| 12-16h | UI 输入、确认、执行、结果矩阵和异常态 |
| 16-18h | 候选对比、研究问题与数据缺口 |
| 18-20h | G1/G2 测试；iFinD 仅在 G0-G2 通过后评估 |
| 20-24h | Eval、成本日志、部署、README、演示录制 |

## 6. 当前 Demo 与真实接入差异

当前静态 Demo 实现了本地确定性筛选和 UI 状态，但股票及数值均为构造数据。它不包含 API Key，不调用扶摇或 iFinD。真实上线的替换点是 `Data Adapter -> Normalized Data -> Quality -> Calculation -> Rule -> Evidence`；UI、Strategy State 和错误语义不应随之改变。

## 7. 成本与运营计量

每次执行在服务端生成 `execution_id`，并记录：输入/输出 Token、模型单价版本、每个 Tool 的调用次数与单价、计算运行时长、存储字节数、重试次数、人工介入分钟数。不得把失败执行的成本从总账中删除；单位成本指标仅以成功执行为分母，同时另报失败率。

在 50 次真实执行完成前，不得在项目汇报中使用“低成本”“可规模化”或“具有商业回报”等结论。50 次数据收齐后，按 `docs/CFO_Review_and_Acceptance.md` 的 A06 和 A10 复核。
