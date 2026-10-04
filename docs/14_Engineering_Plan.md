# 第十四部分 技术实现与开发拆解：方案 B

## 1. 目标架构

```text
Web UI
  -> Strategy API
      -> AI Understanding + Schema Validator
      -> Strategy Store / Version Store
      -> Execution Service
           -> Universe Snapshot Store
           -> Finance / Percentile / Rule Engine
           -> Evidence Builder
      -> Change Detector

Snapshot Job
  -> Fuyao Adapter
  -> Batch / Retry / Quality Gate
  -> Normalized Universe Snapshot
```

方案 B 把昂贵、易超时的数据获取与用户策略执行分开。Snapshot Job 负责构建完整且同一时点的股票池事实；用户执行只读取快照并运行确定性规则。这样可以同时保证全量覆盖、低延迟和结果可复现。

## 2. 核心不变量

1. `candidate + near_miss + not_matched + data_gap + tool_error + not_evaluated = universe_total`。
2. 正式模式下 `not_evaluated = 0`；否则只能发布为样本验证。
3. 只有 `CONFIRMED` Strategy State 可以创建 Execution。
4. Strategy Version、Universe Snapshot 和 Execution 均不可原地覆盖。
5. AI 输出必须经过 Registry 和 Schema Validator；PASS/FAIL 不经过 LLM。
6. 状态变化必须关联新旧两个 Execution，不能凭文本推断原因。

## 3. 模块与 DoD

| 模块 | 任务 | 优先级 | Definition of Done |
| --- | --- | --- | --- |
| Metric Registry | 意图、代理指标、单位、公式、阈值来源、新鲜度 | P0 | AI 和 UI 只能选择 Registry 项 |
| Understanding | Intent Map、代理候选、澄清项、Patch 候选 | P0 | 模糊词不产生已确认固定阈值 |
| Strategy Store | 保存版本、确认、Patch、命名和重跑入口 | P0 | 历史版本不可覆盖 |
| Snapshot Job | 全量成分、估值、财务、价格获取与缓存 | P0 | 300 只全部归类，失败可追踪 |
| Quality Engine | null、少样本、时间、单位、Universe 完整性 | P0 | 异常不正常化，数量可对账 |
| Finance Engine | 增长、CAGR、波动率和股票池分位数 | P0 | 边界单测和公式证据齐全 |
| Rule Engine | 条件状态、结果分组和漏斗 | P0 | 不依赖 LLM；覆盖率 100% |
| Evidence Builder | 事实、规则、阈值来源和 request_id | P0 | 所有非工具失败状态可追溯 |
| Change Detector | 两次 Execution 状态 diff | P0 | 新增符合、退出和质量变化可回查 |
| Frontend | Strategy Canvas、进度、结果 Tabs、保存和重跑 | P0 | 用户能完成表达到保存的闭环 |
| Scheduler | 每日/每周重跑和通知 | P1 | P0 再次运行率验证后接入 |
| iFinD Adapter | 候选研究增强 | P1 | 不影响 P0 筛选和状态 |

## 4. API 草案

| Endpoint | 方法 | 作用 |
| --- | --- | --- |
| `/intents/parse` | POST | 返回 Intent Map、代理候选和澄清项 |
| `/strategies` | POST | 创建 Draft Strategy |
| `/strategies/:id/confirm` | POST | 确认 version + hash |
| `/strategies/:id/save` | POST | 保存并命名已确认策略 |
| `/strategies/:id/patches` | POST | 生成最小 Patch 和影响范围 |
| `/strategies/:id/executions` | POST | 基于指定 Snapshot 创建 Execution |
| `/executions/:id` | GET | 返回覆盖率、进度、漏斗和结果组 |
| `/executions/:id/evidence` | GET | 返回标的和条件 Evidence |
| `/executions/:id/changes?previous=` | GET | 比较两次 Execution |
| `/snapshots/latest` | GET | 返回当前快照时点、覆盖率和质量 |

## 5. 全量快照策略

### 5.1 作业步骤

1. 获取沪深 300 成分并验证数量和唯一性。
2. 分批获取 300 只估值，保存每批 request_id。
3. 以并发池获取财务和 K 线，分别记录失败和重试。
4. 计算原始指标和质量状态。
5. 在同一有效样本中计算 PE 与波动率分位数。
6. 生成 Snapshot Manifest：时点、覆盖率、批次、失败数、字段映射版本和哈希。
7. 原子切换 `latest` 指针；构建失败时继续保留上一个快照并标记 STALE。

### 5.2 24 小时作业的最小实现

若没有数据库和后台任务平台，使用本地或 GitHub Actions 脚本生成一份真实的版本化 JSON Snapshot，再由 Vercel 只读加载。该方案牺牲实时性，但比同步请求只评估 3 只更符合产品真相。页面必须显示快照时间和更新方式。

## 6. 实现顺序

1. 用真实扶摇数据构建一份完整沪深 300 Snapshot，并完成数量对账。
2. 固定 Metric Registry、代理指标和阈值来源 Schema。
3. 实现全量确定性规则、结果分组和 Evidence。
4. 实现 Strategy Canvas，阻断未完成的澄清。
5. 实现策略保存、一键重跑和 Execution diff。
6. 补解析 Eval、覆盖率、异常、合规与变化测试。
7. 上述全部通过后，再考虑定期调度、iFinD 和回测。

## 7. 24 小时优先级调整

| 时间 | 产出 |
| --- | --- |
| 0-4h | 用户任务、代理指标和阈值来源定义；真实接口探测 |
| 4-9h | 完整 Snapshot 脚本、标准化、质量和公式测试 |
| 9-13h | 全量 Rule/Evidence、覆盖率与结果分组 |
| 13-17h | Strategy Canvas、确认和结果页 |
| 17-20h | 保存、重跑和最小 Patch |
| 20-22h | 主链路、异常、合规和解析 Eval |
| 22-24h | 部署、README、AI 记录、已知限制和演示 |

该排期优先保证“全量结果成立”和“策略语义成立”，不在 24 小时内投入多 Agent、复杂研究页或定期通知。

## 8. 当前实现差距

当前实现已经验证扶摇真实调用、CAGR、波动率、Evidence、异常状态和 Patch，但还存在：

- 估值只读取部分成分；
- 深度财务和行情计算最多 3 只；
- 模糊条件仍会带入固定模板阈值；
- Strategy State 仅在浏览器内，尚未持久化；
- 没有 Execution diff 和保存策略页。

因此当前产品应标记为“真实数据策略样本验证”，方案 B 的实现完成状态不能仅由文档变更认定。

## 9. 成本与运营计量

每次 Snapshot 记录数据调用次数、重试、运行时长和存储大小；每次 Execution 记录计算耗时、AI Token、Evidence 数量和状态分布。数据获取成本与用户执行成本分开核算，避免把一次快照复用误算成每位用户都重新请求 300 只股票。
