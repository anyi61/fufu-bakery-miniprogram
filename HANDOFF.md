# FUFU / 小雨面包微信小程序 Handoff

更新时间：2026-08-17（Asia/Shanghai）

## Goal

在保留预约自提、外卖配送、购物车、结算、订单和个人中心业务流程的基础上，复刻 FUFU BAKERY 风格首页，并形成可供第三方全面审查的产品、代码、测试和 T0 技术验证材料。

## Current Progress

- FUFU 首页、三种履约入口、会员中心卡片和四栏原生 tabBar 已实现。
- 顾客端与商家端 Site Demo、原生微信小程序、业务云函数和种子数据脚本均在仓库中。
- PRD v1.1、库存台账模型、订单并发协议、试运行开发计划已归档到 `docs/`。
- T0 探针、定时探针、逻辑测试、执行手册、安全审计和阶段证据已纳入审查包。
- 三个业务云函数已将 `wx-server-sdk` 从浮动的 `latest` 固定为 `4.0.2`，并补充锁文件以支持可复现审查。
- GitHub 公开仓库：<https://github.com/anyi61/fufu-bakery-miniprogram>
- FUFU 首页提交 `8b3a094` 已推送到 `main`；本交接文件随全面审查材料提交继续更新。

## Verified State

- `npm test`：27/27 通过。
- `npm run lint`：0 error；6 个 `<img>` 性能 warning，集中在 `app/page.tsx`，不影响当前功能验收。
- `git diff --check`：通过。
- 当前代码与候选上传文件已执行敏感信息扫描；未发现真实 AppID、环境 ID、密钥或访问令牌。
- 首页已在微信开发者工具游客模式完成比例与渲染检查；游客模式结果不代表真机、云开发、支付或发布验收。

## What Worked

- 使用压缩后的完整猫咪插画底图配合 WXML/WXSS 文字和点击热区，兼顾视觉一致性、清晰度和主包体积。
- 将视觉首页独立为 `pages/landing/index`，继续复用原有点单与结算流程。
- 使用微信原生 tabBar 和独立透明 PNG 图标，避免自定义底栏在模拟器中的不稳定渲染。
- 自动化测试锁定页面注册、导航、入口行为、资源体积、T0 安全门禁和核心探针逻辑。
- 锁定云函数 SDK 版本并保留依赖审计结论，使审查者可以复核供应链风险。

## What Didn't Work / Known Risks

- 自定义 `custom-tab-bar` 与 WXSS 本地背景图方案存在微信 renderer 限制，已删除；不要恢复该路径。
- 微信开发者工具游客 AppID 会产生云 API 和权限提示，不能作为正式环境证据。
- T0 动态探针尚未在真实 CloudBase 测试环境执行，当前文档中的动态证据项仍待补齐。
- `wx-server-sdk@4.0.2` 依赖链的 npm audit 结果包含 5 个 high、1 个 moderate；不能在未验证兼容性的情况下直接升级。
- 支付回调、库存原子扣减、重复请求幂等、并发超卖与服务端权限仍需真实环境验证。

## Next Steps

1. 由 ChatGPT Pro 按 PRD、代码、测试、依赖与安全边界进行全面审查，并按 P0/P1/P2/P3 输出可定位问题。
2. 使用专用测试 CloudBase 环境按 `docs/t0-probe-runbook.md` 执行动态探针；只归档脱敏结果。
3. 在目标机型真机验证四条首页路径、tabBar 安全区、弱网行为和购物车恢复。
4. 补齐支付沙箱、订单幂等、库存并发、退款和权限隔离测试，再评估试营业发布。
5. 修复时按问题拆分提交，复跑 `npm test`、`npm run lint`、差异检查和敏感信息扫描。
