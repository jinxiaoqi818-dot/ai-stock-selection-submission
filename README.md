# AI 投资假设编译与监控工作台

这是“自然语言智能选股与策略解释器”的可运行交付。产品帮助用户把“经营改善、估值合理、走势稳定”等模糊判断拆成可检查的代理指标和规则，再由确定性引擎结合真实金融数据执行和生成 Evidence。

当前 Web 版本完成了真实扶摇接口、全量沪深 300 Snapshot、规则计算、异常状态、Evidence、结构化规则解析和最小 Patch。数据构建采用受保护的分块任务，当前快照覆盖 300/300 只成分，页面筛选直接读取同一版本化快照。

## 在线访问

- Web 产品：<https://ai-stock-selection-submission.vercel.app/demo/>
- 生产健康检查：<https://ai-stock-selection-submission.vercel.app/api/health>
- 真实筛选 API：<https://ai-stock-selection-submission.vercel.app/api/screen>
- GitHub Pages 静态镜像：<https://jinxiaoqi818-dot.github.io/ai-stock-selection-submission/>
- 源码仓库：<https://github.com/jinxiaoqi818-dot/ai-stock-selection-submission>

## 方案 B 产品判断

在第一版实现和真实数据验证后，候选人进行了第二轮产品复盘，确认三个优先问题：

1. 有限样本不能代表完整股票池候选，正式筛选必须覆盖率 100% 并能对账；
2. 模糊投资意图不能被静默转换为固定阈值，必须先选择代理指标和阈值来源；
3. 一次性结果不足以形成持续价值，已确认策略需要保存、重跑并展示状态变化。

因此目标方案调整为“投资假设编译与持续验证”：

```text
自然语言假设
  -> 意图和代理指标澄清
  -> 用户确认 Strategy State
  -> 完整股票池确定性执行
  -> 候选、临界未入选、数据缺口和异常
  -> Evidence 核验
  -> 保存与再次运行
  -> 查看状态变化
```

详细决策见 `docs/Business_Owner_Review_and_Revision.md`。

## 当前可运行能力

- 扶摇真实沪深 300 成分、估值、利润表和历史 K 线；
- 两年归母净利润 CAGR、PE-TTM、60 日年化波动率；
- `PASS`、`FAIL`、`UNKNOWN`、`STALE`、`CONFLICT`、`TOOL_ERROR`、`PARTIAL` 和 `ZERO_RESULT`；
- 来源、时点、字段映射和 `request_id`；
- 模糊条件提示、明确阈值识别和 Unsupported 阻断；
- PE、增长率和波动率的最小 Patch 与版本审计；
- Strategy Canvas：代理指标、阈值来源和阻断式确认；
- 浏览器端保存 Strategy Version、再次运行和 Execution 变化摘要（Demo MVP）；
- 14 项本地与生产自动化测试及 GitHub Actions。
- 结果表支持每页 30/50 条，完整评估数量和筛选漏斗仍按 300 只全量计算。
- 完整沪深 300 真实 Snapshot，覆盖率 100%，候选、临界未入选、其他未通过和数据缺口数量可对账。

## 当前限制

- 模糊条件仍由确定性规则解析器提出建议，开放式 LLM 语义理解尚未接入；
- 产品运行时尚未接入外部 LLM，不声称具备开放语义理解能力；
- 保存、重跑和 Execution diff 当前使用浏览器 localStorage，尚未接入多用户服务端 Strategy Store；
- 尚未接入 iFinD、定期监控或回测；
- 20 名用户、50 次真实执行和 100 条 Evidence 抽样尚未执行。

## 下一实施顺序

1. 将浏览器 localStorage 迁移为服务端 Strategy Store，支持多用户历史和权限；
2. 在 UI 中增加候选、临界未入选、其他未通过、数据缺口和工具错误 Tabs；
3. 完成 20 名用户、50 次真实执行和 100 条 Evidence 的正式验收；
4. 上述闭环验证后，再评估定期监控、iFinD 和回测。

## 本地运行

静态页面可以直接打开 `demo/index.html`，但真实 API 需要 Vercel 或兼容的 Node Serverless 环境。

```bash
npm test
npx vercel dev
```

服务端必须配置：

```text
FUYAO_API_KEY
```

密钥只能存放在本地未跟踪环境文件或部署平台 Secret 中，不能提交到仓库或浏览器代码。

## 文档导航

| 路径 | 内容 |
| --- | --- |
| `docs/10_PRD.md` | 方案 B 产品需求、用户任务和验收分层 |
| `docs/11_AI_Design.md` | AI 职责、Intent Map、Strategy State 和 Eval |
| `docs/12_Data_and_Tools.md` | 全量快照、分位指标、覆盖率和数据质量 |
| `docs/13_UIUX_Spec.md` | Strategy Canvas、全量结果、保存和变化体验 |
| `docs/14_Engineering_Plan.md` | Snapshot Job、持久化、Execution diff 和实现顺序 |
| `docs/15_Test_and_Submission.md` | 测试、AI 使用记录和提交清单 |
| `docs/Business_Owner_Review_and_Revision.md` | 候选人的产品复盘与方案 B |
| `docs/CFO_Review_and_Acceptance.md` | Pilot 量化验收与预算闸门 |
| `tests/TEST_REPORT.md` | 已执行测试和未完成项 |

## 产品边界

- 不输出涨跌预测、收益承诺、股票排名或买卖建议；
- AI 只提出意图和规则候选，不生成金融事实或决定 PASS/FAIL；
- 用户确认前不执行最终策略；Patch 未确认前不改变已执行版本；
- 异常和缺失不会被伪装成普通不满足；
- 全量结果必须显示 Snapshot 时点、覆盖率和可对账状态数量。
