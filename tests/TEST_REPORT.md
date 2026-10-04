# 测试报告

测试日期：2026-10-04 14:21（Asia/Shanghai）

测试对象：`main` 分支、本地确定性计算逻辑和 Vercel 生产环境

生产地址：https://ai-stock-selection-submission.vercel.app

## 自动化结果

运行命令：`npm test`

运行环境：Node.js v24.14.0

结果：**12/12 通过，0 失败**

机器可读证据：`tests/results/latest.json`

| 范围 | 用例数 | 状态 | 实际证据 |
| --- | ---: | --- | --- |
| CAGR 与缺失数据 | 3 | 通过 | 三期 CAGR、少样本 `UNKNOWN`、null 不转换为 0 |
| 波动率计算 | 1 | 通过 | 少于 61 根为 `UNKNOWN`，61 根可计算 |
| 参数与异常 | 2 | 通过 | 非法参数 `INVALID`；冲突阈值 HTTP 409 `CONFLICT` |
| 合规与状态 | 1 | 通过 | 合规拒绝文案及 `TOOL_ERROR/STALE/CONFLICT/ZERO_RESULT/PARTIAL` 路径存在 |
| Secrets 扫描 | 1 | 通过 | 扫描所有 Git 已跟踪文本文件，无已知凭据前缀 |
| 生产健康检查 | 1 | 通过 | HTTP 200，扶摇 Secret 已配置 |
| 生产真实数据链路 | 1 | 通过 | 来源为扶摇；完整 Snapshot 覆盖 300/300；结果分组数量可对账；包含 Evidence 和 `request_id` |
| 生产零结果 | 1 | 通过 | `pe_max=0.1` 全量评估 300 只并返回 `ZERO_RESULT`，候选数为 0 |
| 生产冲突 | 1 | 通过 | `pe_min=30&pe_max=20` 返回 HTTP 409 `CONFLICT` |

## 已验证结论

- Demo 主链路已使用扶摇真实指数成分、估值、利润表和 K 线，不再使用构造股票；版本化 Snapshot 已完成沪深 300 的 300/300 覆盖。
- `PASS/FAIL/UNKNOWN` 由确定性代码计算；异常不会静默变成正常结果。
- 生产结果保留数据源、时点、字段映射和工具 `request_id`。
- Git 已跟踪文件没有发现用户提供的扶摇 Key 或常见 GitHub Token 形态。

## 尚未执行

- 尚未完成 20 名真实用户任务测试、50 次生产执行和 100 条 Evidence 人工抽样。
- `STALE`、上游超时及部分标的失败已实现代码路径，但未对生产扶摇服务注入故障。
- 未做跨浏览器矩阵和正式无障碍审计。

以上未执行项不会标记为通过，也没有使用构造记录替代真实证据。
