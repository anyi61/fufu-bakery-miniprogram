# 小雨面包原生微信小程序

这是从现有 Site 设计迁移出的原生微信小程序工程。Site 继续用于网页演示；本目录才是微信开发者工具的导入目录。

## 当前可运行范围

- 顾客端：菜单、分类、实时余量、购物袋、自提时段、确认订单、体验支付、订单进度和动态取餐码。
- 门店端：订单接单、制作、备妥、核销、生产看板、时段负载、库存和临时售罄。
- 云后端：微信 `openid` 身份、员工白名单、事务预占、支付确认、状态机、审计和第三方集成事件。
- 首发只支持预约到店自提，没有配送入口、地址、骑手或配送费用。

## 立即体验：无 AppID / 无云环境

1. 安装微信开发者工具。
2. 导入本目录 `wechat-miniprogram/`。
3. 使用 `project.config.json` 中的 `touristappid`。
4. 保持 `miniprogram/config/runtime.js` 的 `demoMode: true` 和 `paymentMode: "demo"`。
5. 编译后即可从顾客点单跑到门店核销。体验数据保存在开发者工具本地 Storage，可在“我的”中重置。

## 接入正式云开发

1. 将 `project.config.json` 的 AppID 换成小雨面包自有小程序 AppID；建议用不提交 Git 的 `project.private.config.json` 保存本机配置。
2. 在开发者工具开通云开发，创建环境，将环境 ID 写入 `miniprogram/config/runtime.js`。
3. 创建集合：`products`、`pickup_slots`、`orders`、`audit_logs`、`integration_events`、`staff`。
4. 将数据库权限设置为所有客户端不可直接读写，可参考 `database.rules.json`。全部业务访问均经过云函数。
5. 分别右键上传并部署 `cloudfunctions/bakery`、`cloudfunctions/seed`、`cloudfunctions/payment`，选择“云端安装依赖”。
6. 临时执行一次 `seed` 云函数：初始化六个商品、当天三个时段，并将执行人的 `openid` 写入 `staff` 作为门店 owner。
7. 把 `demoMode` 改成 `false`。保留 `paymentMode: "demo"` 可以先验收云数据库订单闭环。

## 正式微信支付

当前 `payment` 云函数是明确失败的安全占位，防止未配置商户资料时误判支付成功。生产接入需要：

- 自有已认证小程序 AppID、微信支付商户号及绑定关系；
- API v3 密钥、商户证书/私钥、平台证书或公钥；
- 服务端下单和支付回调；回调校验签名、订单归属、币种和金额；
- 回调或服务端查单调用 `confirmPayment` 等价事务，重复回调保持幂等；
- 退款、订单发货管理和对账流程。

接通后，把 `runtime.js` 的 `paymentMode` 改成 `wechat`，由 `services/payment.js` 调用 `wx.requestPayment`。小程序端回调只负责刷新订单，不能直接把订单标为已支付。

## 银豹、打印和订阅消息

`cloudfunctions/bakery/adapters.js` 已提供银豹、云打印和订阅消息边界，当前记录 demo 集成事件。取得银豹开放平台凭据、SKU 映射、打印机型号和模板 ID 后，将 adapter 内实现替换为真实服务调用；凭据必须存云函数环境变量或密钥管理，不能写入小程序包。

## 生产注意事项

- 订单预占 10 分钟；每次读取菜单或创建订单时会清理过期预占。正式高流量环境建议额外配置每分钟定时触发器，缩短无人访问时的释放延迟。
- 商品图片当前来自外部图片服务；正式上线应迁移至小程序云存储或已备案 HTTPS 域名。
- 正式门店地址、电话、营业时间、商品和协议文本仍需替换。
- 上传审核前完成隐私保护指引、用户协议、食品经营资质、类目、备案、支付和订单发货管理。
