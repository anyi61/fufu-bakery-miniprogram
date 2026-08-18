# Security Policy

## 当前支持范围

本仓库仍处于产品 Demo 和隔离技术验证阶段，没有生产支持版本。请勿向仓库、Issue、日志或截图提交真实 AppID、CloudBase 环境 ID、支付密钥、证书、手机号、订单或 operator token。

## 报告安全问题

请通过 GitHub 仓库的 Private vulnerability reporting 提交安全问题。报告应包含受影响提交、文件、复现条件、影响和建议修复；不要创建包含利用细节或凭据的公开 Issue。

## 已知边界

- 真实支付、退款、对账和隐私数据闭环尚未完成。
- CloudBase T0 动态证据尚未完成。
- `wx-server-sdk@4.0.2` 的传递依赖风险仍待兼容升级和可达性验证。
- Site/D1 是交互 Demo，不是生产商户后台；商户 API 默认关闭。

任何生产部署都必须通过 `docs/remediation-execution-plan.md` 定义的环境门禁。
