# AI 智能选股策略编译器

这是“自然语言智能选股与策略解释器”笔试题的可运行交付包。产品将用户的选股表达转为可检查、可修改、需确认后才执行的 Strategy State；筛选和条件判断由确定性规则完成，AI 只负责理解、澄清、结构化和基于证据的说明。

## 交付内容

| 路径 | 内容 |
| --- | --- |
| `docs/10_PRD.md` | MVP 产品需求文档 |
| `docs/11_AI_Design.md` | Agent Prompt、Schema、状态机与 Eval |
| `docs/12_Data_and_Tools.md` | 扶摇、iFinD 的工具映射、数据契约和异常策略 |
| `docs/13_UIUX_Spec.md` | 页面、组件、交互与视觉规范 |
| `docs/14_Engineering_Plan.md` | 架构、任务拆解和真实数据接入路径 |
| `docs/15_Test_and_Submission.md` | 测试说明、AI 使用记录模板和提交清单 |
| `docs/Business_Owner_Review_and_Revision.md` | 业务问题复核、范围修订与 G0-G3 阶段闸门 |
| `docs/CFO_Review_and_Acceptance.md` | 成本审查与 A01-A13 量化验收标准 |
| `demo/` | 可直接打开的静态交互 Demo |
| `tests/TEST_REPORT.md` | 已执行与待执行测试的真实状态 |

## 运行 Demo

直接双击打开 `demo/index.html`，即可体验完整的演示主链路：

1. 输入或使用示例策略。
2. 查看 AI 解析并确认策略。
3. 执行确定性筛选，查看 Pass、Fail、Unknown 与证据。
4. 选择最多三只标的进行同口径事实对比，查看数据缺口与待研究问题。
5. 输入“把 PE 改成 20，其他不变”，确认 Patch 后重新运行。

Demo 使用的是**构造的演示数据**，页面顶部会明确标识。它用于展示交互和规则引擎的产品闭环，不能作为真实金融结论。正式部署时，应按 `docs/12_Data_and_Tools.md` 的运行时 Tool Catalog 完成扶摇与 iFinD 适配，并在服务端注入密钥。

## 在线访问与源码

- 在线 Demo：<https://jinxiaoqi818-dot.github.io/ai-stock-selection-submission/>
- 源码仓库：<https://github.com/jinxiaoqi818-dot/ai-stock-selection-submission>

GitHub Pages 从 `main` 分支自动发布。根地址会跳转到 `demo/`，该站点为构造数据演示，不提供真实金融数据或投资结论。

## 产品边界

- 不输出涨跌预测、收益承诺或买卖建议。
- 用户确认前不执行最终策略；每次修改均生成待确认 Patch。
- 事实来自工具数据，计算和判断来自确定性引擎；LLM 不编造数值和结论。
- 缺失、过期、冲突和工具失败分别保留为 `UNKNOWN`、`STALE`、`CONFLICT`、`TOOL_ERROR`，不伪装为正常结果或 Fail。
- 不提交 API Key、个人信息、持仓或受限数据。请从 `.env.example` 复制为本地环境文件后配置。

## 提交前需要补齐

1. 在连接真实 MCP 后记录实际 Tool 名称、请求参数、响应字段和运行日志。
2. 使用真实运行记录填写 AI 使用与验证记录，不能照抄或虚构。
3. 运行 `tests/test-cases.md` 的全部用例，保存测试结果。
