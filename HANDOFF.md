# FUFU 面包小程序首页复刻 Handoff

更新时间：2026-08-17（Asia/Shanghai）

## Goal

参考用户提供的「FUFU BAKERY」微信小程序截图，在现有原生微信小程序中复刻同风格首页，同时保留已有点单、结算、订单和个人中心业务流程。

目标页面结构：

- 顶部弧形 `FUFU BAKERY / BAKERY HOUSE` 品牌标题。
- 皇冠灰色虎斑猫抱面包的主视觉。
- 到店自取、外卖配送、快递邮寄三个入口。
- 会员充值中心卡片。
- `首页 / 点单 / 订单 / 我的` 四栏底部导航。

## Current Progress

### 已实现

- 新增原生小程序视觉首页：
  - `wechat-miniprogram/miniprogram/pages/landing/index.wxml`
  - `wechat-miniprogram/miniprogram/pages/landing/index.wxss`
  - `wechat-miniprogram/miniprogram/pages/landing/index.js`
  - `wechat-miniprogram/miniprogram/pages/landing/index.json`
- 新增 imagegen 生成并压缩的首页插画：
  - `wechat-miniprogram/miniprogram/assets/fufu/fufu-home-art.jpg`
- 新增四枚透明猫咪 tabBar 图标：
  - `wechat-miniprogram/miniprogram/assets/fufu/tabbar/home.png`
  - `wechat-miniprogram/miniprogram/assets/fufu/tabbar/order.png`
  - `wechat-miniprogram/miniprogram/assets/fufu/tabbar/orders.png`
  - `wechat-miniprogram/miniprogram/assets/fufu/tabbar/profile.png`
- 更新 `wechat-miniprogram/miniprogram/app.json`：
  - `pages/landing/index` 成为首个页面。
  - 原生 tabBar 改为 `首页 / 点单 / 订单 / 我的` 四栏。
- 首页入口行为：
  - 到店自取、外卖配送：`wx.switchTab` 进入现有点单页。
  - 快递邮寄：显示“快递邮寄即将开放”。
  - 会员充值中心：进入“我的”。
- `tests/miniprogram.test.mjs` 新增 FUFU 首页回归测试，覆盖首页注册、四栏导航、入口绑定、插画与图标体积限制。

### 已验证

- 2026-08-17 最新执行 `npm test`：27/27 通过。
- `git diff --check` 通过。
- 小程序 `miniprogram` 目录约 680 KB。
- 首页插画约 420 KB，小于测试规定的 1 MiB。
- 四枚 tabBar 图标分别约 7–11 KB，小于微信 40 KiB 单图限制。
- 微信开发者工具 Stable v2.01.2510290 已完成页面比例预览；FUFU 主视觉、三入口和会员卡片均正常渲染。
- 最终编译未暴露本次页面产生的 renderer error。

### Git 状态

- 本次修改尚未提交、尚未推送、尚未上传或发布小程序。
- 当前最新提交仍是：`ef53f8e test(miniprogram): 校准首页布局兼容性断言`。
- 本次任务应只处理以下文件：
  - `HANDOFF.md`
  - `tests/miniprogram.test.mjs`
  - `wechat-miniprogram/miniprogram/app.json`
  - `wechat-miniprogram/miniprogram/pages/landing/`
  - `wechat-miniprogram/miniprogram/assets/fufu/`
- 工作区已有其他未提交改动，包括 `.gitignore`、云函数 package 文件、T0 probe、并发协议和文档。这些属于其他工作，禁止 reset、stash、discard、覆盖或混入本次提交。

## What Worked

- 使用 imagegen 生成一张完整竖版猫咪插画底图，再用 WXML/WXSS 覆盖准确文字和透明点击热区，兼顾视觉一致性和文字清晰度。
- 将首页独立为 `pages/landing/index`，继续复用原有 `pages/home/index` 点单流程，避免重写购物车和结算逻辑。
- 使用微信原生 tabBar 管理四栏导航和安全区；每个栏目使用独立透明 PNG 图标。
- 用回归测试锁定资源体积、入口行为和四栏配置，避免视觉资源挤占主包或后续误删导航。
- 开发者工具中的游客 AppID/API 报错属于游客模式环境限制；页面渲染和本地自动化测试不受影响。

## What Didn't Work

- 最初尝试使用自定义 `custom-tab-bar`，并通过 WXSS `background-image` 裁切首页插画作为图标。
  - 微信不允许 WXSS 直接读取本地资源背景图，产生 renderer error。
  - 改为 `<image>`/`<cover-image>` 后虽然可编译，自定义底栏在模拟器截图中仍没有稳定显示。
  - 已删除自定义 tabBar，切换为微信原生 tabBar。不要恢复该方案。
- 微信开发者工具首次通过 computer-use 读取时超时；使用 bundle id `com.tencent.webplusdevtools` 后成功。
- 开发者工具会出现 `tourist appid`、`webapi_getwxaasyncsecinfo:fail` 和 `wx.operateWXData` 游客模式提示。它们不是本次首页代码错误，也不能作为正式 AppID 或已发布的证据。

## Next Steps

1. 在微信开发者工具中使用目标机型再次检查原生 tabBar 的实际显示、图标清晰度和底部安全区；当前可访问性树已加载四栏与四枚图标。
2. 点击验证四条路径：
   - 首页 → 到店自取 → 点单。
   - 首页 → 外卖配送 → 点单。
   - 首页 → 快递邮寄 → Toast。
   - 首页 → 会员充值中心 → 我的。
3. 如果用户继续要求“1:1”细调，优先调整 `pages/landing/index.wxss` 中品牌弧度、服务文字纵向位置和会员卡文案位置，不要改动业务页。
4. 修改后执行：

   ```bash
   npm test
   git diff --check
   ```

5. 若用户要求提交：
   - 只暂存上方列出的本次任务文件。
   - 检查 `git diff --cached --check`、暂存文件清单和敏感信息。
   - 创建本地提交；除非用户明确要求“推送”，不要 push。
6. 若要上传、真机预览或发布，需要有效小程序 AppID 和用户明确授权；游客模式预览不构成上线证据。
