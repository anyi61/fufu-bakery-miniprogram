# FUFU / 小雨面包微信小程序

面包预约自提项目，包含可点击业务 Demo、原生微信小程序、云函数和面向全面代码审查的产品与技术材料。

> 当前仓库用于产品评审、技术验证和开发交接。CloudBase T0 动态验证尚未完成，不能据此判断已具备生产上线条件。

## 仓库结构

- `app/`、`lib/`：顾客端与商家端可点击 Site Demo。
- `wechat-miniprogram/miniprogram/`：可导入微信开发者工具的原生小程序，包含 FUFU 首页、点单、结算、订单和个人中心。
- `wechat-miniprogram/cloudfunctions/`：业务云函数、种子数据工具，以及临时 T0 探针。
- `docs/`：PRD、库存模型、并发协议、安全审计、验证手册与阶段证据。
- `tests/`：Site、小程序配置和 T0 探针逻辑的自动化测试。
- `HANDOFF.md`：当前进度、验证结果、风险和后续工作。

## 快速开始

要求 Node.js `>=22.13.0`。

```bash
npm install
npm test
npm run lint
npm run dev
```

原生小程序请在微信开发者工具中导入 `wechat-miniprogram/`。游客 AppID 可用于本地界面检查；云开发、支付、真机预览和发布需要有效 AppID 与对应权限。详细说明见 [wechat-miniprogram/README.md](wechat-miniprogram/README.md)。

## 审查入口

建议按以下顺序阅读：

1. [产品需求文档](docs/小雨面包微信小程序-PRD-v1.1.md)
2. [开发计划](docs/wechat-trial-run-dev-plan.md)
3. [库存台账模型](docs/inventory-ledger-model.md)
4. [订单并发协议](docs/order-concurrency-protocol.md)
5. [T0 验证手册](docs/t0-probe-runbook.md)
6. [SDK 与依赖安全审计](docs/t0-sdk-security-audit.md)
7. [T0 阶段证据](docs/t0-spike-evidence.md)
8. [交接文档](HANDOFF.md)

## 安全与生产边界

- 不要提交真实 AppID、CloudBase 环境 ID、密钥、操作员令牌、`project.private.config.json`、探针 `cloudbaserc.json` 或 `artifacts/` 动态产物。
- T0 配置样例仅包含占位符；测试中的固定令牌为无权限的合成测试数据。
- `wx-server-sdk@4.0.2` 的现有依赖链仍有 npm audit 报告项，详见安全审计文档，升级前需验证微信云函数兼容性。
- 支付、库存扣减、幂等、并发与权限结论必须以真实测试环境的动态证据为准。
- Site 商户 API 默认关闭；本地或受控评审环境如需启用，必须同时设置 `MERCHANT_API_ENABLED=true` 和服务端 `MERCHANT_USER_IDS` allowlist。该门禁不替代后续数据库 RBAC。
- 原生小程序首发业务固定为预约到店自提；外卖配送和快递邮寄只保留视觉入口并提示“即将开放”。

## 常用命令

- `npm run dev`：启动 Site 本地开发环境。
- `npm run build`：验证 Site 构建。
- `npm test`：构建并执行全部自动化测试。
- `npm run test:miniprogram`：只执行原生小程序回归测试。
- `npm run lint`：执行 ESLint。
