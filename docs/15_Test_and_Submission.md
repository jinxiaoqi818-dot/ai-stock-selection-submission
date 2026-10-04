# 第十五部分 测试 README 与笔试提交材料

## 1. 测试范围

| 类别 | 场景 | 预期 |
| --- | --- | --- |
| 主链路 | 输入、实体解析、澄清、确认、执行、证据 | 策略版本和 Evidence 可回查 |
| 编辑 | “PE 改成 20，其他不变” | 仅估值条件变更，生成 v2 |
| 实体歧义 | “白酒里找便宜的” | 不执行，要求选择 Universe |
| 指标歧义 | “走势稳定” | 明示指标与阈值建议，等待确认 |
| 缺失值 | PE 为 null | `UNKNOWN`，不计为 FAIL |
| 数据过期 | as_of 超阈值 | `STALE`，不能标“最新” |
| 冲突 | 期间或单位不可比 | `CONFLICT`，无自动选值 |
| 工具失败 | 核心 Tool 超时/5xx | `TOOL_ERROR`，可重试、无正常结论 |
| 零结果 | 条件过严 | 展示漏斗，不自动放宽 |
| 合规 | 请求预测/买入建议 | 无预测、承诺或交易指令 |
| 安全 | Secrets 扫描 | 仓库中无真实密钥、隐私、受限数据 |

详细可执行用例见 `tests/test-cases.md`。最终验收必须执行 `docs/CFO_Review_and_Acceptance.md` 的 A01-A13，并遵守 `Business_Owner_Review_and_Revision.md` 的 G0-G3 阶段闸门；真实接入后需记录运行日期、Tool Contract 版本、输入、输出状态、证据样本、成本和工时。

## 2. AI 使用与验证记录

记录日期：2026-10-04

本项目使用 OpenAI Codex 编码代理辅助分析、编码、部署和测试。用户负责确认交付顺序、GitHub/Vercel 账户授权、扶摇 API Key 创建以及各阶段是否继续。产品当前运行时没有调用外部 LLM；自然语言解析是可审计的确定性规则 MVP，不能描述为已经接入大模型。

在完成首版实现后，候选人以 AI 产品经理视角进行了第二轮方案复盘，并最终审定以下三个核心产品判断：有限样本不能代表完整股票池候选；模糊投资意图不能被静默转换为固定阈值；一次性结果需要通过保存和重跑形成持续验证闭环。候选人据此将方案修订为“AI 投资假设编译与监控工作台”，并重新确定了 P0 优先级。Codex 在该环节用于辅助发现风险、挑战假设、整理方案和同步文档，最终判断、范围取舍与方案确认由候选人完成。

| 阶段 | 使用的 AI 工具 | AI 参与内容 | 人工验证与修正 | 证据 |
| --- | --- | --- | --- | --- |
| 产品分析 | OpenAI Codex | 对原始题目和已有交付物做缺口检查，按真实数据、解析、异常、测试、记录和文档排列实施顺序 | 用户确认按阶段实施，并要求以必交付物为主、不伪造高强度量化验收 | `docs/10_PRD.md`、`docs/Business_Owner_Review_and_Revision.md` |
| AI 设计 | OpenAI Codex | 整理 Intent、Strategy State、Patch、Evidence Schema 和状态机；实现规则解析 MVP | 明确修正为“未接入运行时 LLM”，模糊阈值保留澄清，Unsupported/Conflict 阻断执行 | `docs/11_AI_Design.md`；提交 `25ca6be`、`5ea03f4` |
| 数据接入 | OpenAI Codex + 扶摇 REST API | 根据扶摇文档映射沪深 300 成分、估值、利润表和历史 K 线，计算 CAGR 与波动率 | 用户创建 API Key 并授权部署；密钥只存 Vercel Secret；首版因 Hobby 时限明确限制为 3 只，复盘后改为受保护的分块构建与版本化 Snapshot | 提交 `b2e4f2a`、`418655d`；`data/universe-snapshot.json`；生产 `/api/screen` 的 `request_id` |
| 工程实现 | OpenAI Codex | 编写 Vercel API、真实数据前端、最小 Patch、版本审计及异常状态 | 生产 502 后定位函数超时并缩小批次；发现极低 PE 返回负 PE 后修正为只接受正 PE | 提交 `b885815`、`b6b8b63`、`d40f515` |
| 测试 | OpenAI Codex | 编写 12 项单元、安全与生产冒烟测试，生成 JSON 运行证据和 GitHub Actions | Node/curl 在本机网络失败后改用 PowerShell HTTP 客户端；最终本地和 CI 均通过 | `tests/TEST_REPORT.md`、`tests/results/latest.json`；提交 `ed0d370`；Actions run `37182707929` |
| 合规检查 | OpenAI Codex | 添加预测/荐股拒绝、异常不得转为 PASS/FAIL、已跟踪文件 Secrets 扫描 | 未把未执行的 20 用户、50 次运行、100 条 Evidence 抽样写成已通过 | `tests/test-cases.md`、`tests/TEST_REPORT.md` |
| 产品二次复盘 | OpenAI Codex 辅助审查 | 从产品承诺、策略语义和持续使用闭环三个角度挑战首版方案，并协助整理方案 B | 候选人审定三项问题，决定优先全量覆盖、阻断式澄清、保存与重跑；在全量覆盖完成前坚持只称为策略样本验证 | `docs/Business_Owner_Review_and_Revision.md`、方案 B 版 `docs/10_PRD.md` 至 `docs/14_Engineering_Plan.md` |
| 方案 B 第一项落地 | OpenAI Codex + 扶摇 REST API | 实现受保护的分块构建脚本、300 只标准化 Snapshot、确定性全量筛选和覆盖率对账 | 候选人将“完整股票池覆盖”提升为 P0；实际验证 300/300、覆盖率 100%，四类结果合计 300；未将后续两项 P0 提前标为完成 | `scripts/build-snapshot.js`、`data/universe-snapshot.json`、`tests/results/latest.json`；生产 `/api/screen` |

### 2.1 关键人工判断和修正

1. 用户明确选择公开 GitHub 仓库，并完成 GitHub 与 Vercel 的账户授权。
2. 用户提供扶摇文档和 API Key；实现中 Key 仅配置为 Vercel Secret，未写入源码、测试结果或提交文档。
3. Codex 初始真实筛选请求超过 Vercel Hobby 运行时间，首版将估值批次限制为 30、深度评估限制为 3，并在响应和页面中公开该限制；候选人复盘后认为这不足以支撑“沪深 300 候选”承诺，改为受保护的分块构建、版本化快照和只读全量筛选。
4. 测试发现负 PE 会被极低上限选中，随后增加 `pe_ttm > 0` 校验，生产 `ZERO_RESULT` 路径验证通过。
5. 产品运行时解析仍为规则引擎；在配置并验证真实 LLM 服务前，不宣称具备大模型语义泛化能力。
6. 候选人复盘后否决了“有限样本也可作为正式沪深 300 候选”的隐含假设，要求正式结果覆盖率为 100%，否则必须显式切换为样本验证模式。
7. 候选人将 10%、25x、30% 从默认执行规则降级为模板建议，方案 B 改为先选择代理指标，再确认用户明确值或股票池分位数。
8. 候选人认为“研究入口”仍不足以形成复用价值，因此将保存策略和再次运行提升为 P0，将定期监控、iFinD 和回测后置。
9. 全量 Snapshot 于 2026-10-04 实际生成，覆盖 300/300 只沪深 300 成分；候选人只将“全量覆盖”认定为已完成，Strategy Canvas、策略保存和再次运行仍保留为未完成。

### 2.2 已知 AI 边界

- Codex 生成的代码和文档经过语法检查、自动化测试、生产 API 调用和用户阶段确认，但不等于正式金融模型验证。
- 扶摇返回的数据是事实输入；`PASS/FAIL/UNKNOWN`、CAGR 和波动率由确定性代码计算，不由 AI 决定。
- 尚未执行的用户研究、批量生产运行和 Evidence 人工抽样继续保留为未完成，不使用 AI 生成数据代替。

## 3. 最终提交清单

- [x] 可访问且可实际操作的 Web 产品 URL：<https://ai-stock-selection-submission.vercel.app/demo/>
- [x] 源码仓库与 README，包含启动方式、环境变量和已知限制：<https://github.com/jinxiaoqi818-dot/ai-stock-selection-submission>
- [x] 扶摇真实核心筛选调用的 Tool Contract 或运行日志：`tests/results/latest.json` 与生产 `/api/screen`
- [x] iFinD 实际调用记录，或明确其在 MVP 中为何降级：方案 B 将其置于全量数据闭环、保存和重跑之后
- [x] 主链路、异常、合规测试报告
- [x] 真实的 AI 使用与验证记录
- [ ] 60-180 秒演示视频（可选）
- [x] 仓库 Secrets 扫描通过，无个人隐私和受限数据
- [ ] CFO 验收 A01-A13 全部通过，并附上原始日志、账单和工时记录
- [ ] G0-G3 阶段闸门记录完整，未在 G0 通过前宣称真实数据能力

## 4. 建议演示脚本

1. 输入“在沪深 300 里找近两年利润增长较快、PE 不要太高、走势比较稳定的公司”。
2. 展示 AI 的指标建议和用户确认动作，而不是跳过澄清。
3. 展示筛选漏斗、条件矩阵以及某只股票的 Evidence。
4. 输入“把 PE 改成 20，其他不变”，展示 Patch 与 v2 结果。
5. 切换到缺失数据或工具失败样例，说明 Unknown 和 Tool Error 不会被伪装成普通结果。
6. 明确说明 Demo 的数据来源和产品不提供投资建议的边界。
