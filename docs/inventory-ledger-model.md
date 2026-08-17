# 库存预占账本模型（T0 冻结稿）

> 状态：T0 草案 v0.6，随 `wechat-trial-run-dev-plan.md` v0.6 一并评审；第五轮意见已定向修订
> 配套文档：`docs/order-concurrency-protocol.md`、`docs/t0-sdk-security-audit.md`
> 原则：预占记录是交易依据，日库存/时段计数只是其物化视图；业务代码不得绕过预占记录直接改计数。

## 1. 范围

- 首发单店也必须带 `storeId`；
- 库存维度：`storeId + businessDate + skuId`；
- 时段维度：`storeId + businessDate + slotId`；
- 每订单一条预占记录，同时覆盖商品行与时段；
- `businessDate` 统一按 `Asia/Shanghai` 生成。

## 2. 集合与唯一键

### 2.1 `stores`

`storeId`、名称、地址、电话、营业状态、营业日历、时区、最晚下单时间规则、状态。

### 2.2 `product_skus`（商品目录）

`skuId`、`productId`、名称、图片、`priceCents`、上下架状态、预订提前量、单品限购、整单限购、状态。商品目录不保存库存计数。

### 2.3 `inventory_plans`

| 字段 | 类型 | 说明 |
|---|---|---|
| `planId` | string | 确定性 `storeId|businessDate|skuId` |
| `storeId / businessDate / skuId` | string | 维度 |
| `plannedStock` | number | 计划可售数，≥0 |
| `reservedUnits` | number | 预占中件数，≥0 |
| `soldUnits` | number | 已售件数，≥0 |
| `version` | number | 乐观锁 |
| `updatedAt` | string | 时间 |

- 唯一约束：`(storeId, businessDate, skuId)`。
- 服务端可用量：`plannedStock - reservedUnits - soldUnits`；只有事务校验结果可阻止下单，前端展示值不具权威性。
- 计数只由 `order_reservations` 状态迁移事务更新。

### 2.4 `slot_plans`

| 字段 | 说明 |
|---|---|
| `slotPlanId` | 确定性 `storeId|businessDate|slotId` |
| `storeId / businessDate / slotId` | 维度 |
| `startsAt / endsAt` | 时段 |
| `capacity` | 最大订单数 |
| `reservedOrders / paidOrders` | 物化计数 |
| `isClosed` | 关闭状态 |
| `version / updatedAt` | 乐观锁 |

- 唯一约束：`(storeId, businessDate, slotId)`。

### 2.5 `order_reservations`

| 字段 | 类型 | 说明 |
|---|---|---|
| `reservationId` | string | `res_<orderId>`，唯一 |
| `orderId` | string | 唯一约束 |
| `customerOpenId` | string | 归属 |
| `storeId / businessDate / slotId` | string | 履约维度 |
| `items` | array | `[{skuId, productId, quantity}]`，已合并、已校验 |
| `state` | string | `reserved / settled_paid / released_cancelled / released_timeout` |
| `releasedBy / releasedReason` | string/null | 释放来源 |
| `settledAt / releasedAt` | string/null | 时间 |
| `version` | number | 乐观锁 |

不变量：

- 一个订单最多一条预占记录；
- 状态只允许 `reserved -> settled_paid` 或 `reserved -> released_cancelled/released_timeout` 一次；
- 终态后 `items` 不可变。

### 2.6 订单快照

订单保存：

- `fulfillmentSnapshot`：`storeId, businessDate, slotId, startsAt, endsAt, 门店地址/取货指引`；
- `feeSnapshot`：商品小计、包装费、优惠、实付；
- `itemsSnapshot`：`skuId/productId/名称/单价/数量/行小计`；
- `ruleSnapshot`：取消规则版本、协议版本、隐私提示版本、最晚下单时间规则版本。

历史订单不随商品价格、时段或规则配置变化。

## 3. 输入规范化与订单上限

`reserveOrder` 服务端处理顺序：

1. `items` 非空；
2. 重复 `skuId` 行合并；
3. 每个 `skuId` 必须存在且上架；
4. 数量必须为正整数；单行 ≤ 10；总件数 ≤ 30；
5. 不同 SKU 行数 ≤ 20；
6. 单品限购与整单限购校验；
7. 服务端重算价格，前端金额不作为扣款依据；
8. 营业状态、营业日历、履约日期、最晚下单时间、提前量、时段容量校验，缺配置即拒绝下单并告警。

订单上限与事务写预算：

- 单事务写文档数**项目预算上限为 40**；数据库真实上限待 T0 spike 实测，实测值低于预算时下调业务上限并更新本文；
- 预占事务预估：订单 1 + 幂等记录 1 + 预占记录 1 + `inventory_plans` ≤20 + `slot_plans` 1 + `order_events` 1 = 25；
- 结算事务预估：订单 1 + 预占记录 1 + `inventory_plans` ≤20 + `slot_plans` 1 + `payment_attempts` 1 + `order_events` 1 + `audit_logs` 1 + outbox ≤1 = 27；
- T0 SDK spike 实测事务写上限若低于 40，则相应下调最大 SKU 行数并写入本文。

## 4. 幂等预占

- 集合 `order_idempotency`：
  - `_id = sha256(customerOpenId + ":" + idempotencyKey)`，唯一；
  - `orderId`、`requestDigest`、`digestVersion`、`keyVersion`、`createdAt`。
- `requestDigest = HMAC-SHA256(serverKey, canonicalRequest)`，`digestVersion = "hmac-sha256-v1"`。
- canonicalRequest 至少包含：`storeId, businessDate, slotId, items[{skuId, quantity}]`；姓名、手机号、备注如参与一致性比较，也放入 HMAC 输入。
- 摘要不入客户端、日志、埋点。
- HMAC 密钥轮换后，复核已有幂等记录必须按该记录保存的 `keyVersion` 选择旧密钥重新计算；新请求使用新密钥。禁止只按当前密钥复核旧记录。
- 并发同键：同一 `_id` 只能创建一次；创建成功者继续建订单。冲突者读回已有记录：
  - 摘要相同：返回已有订单，`alreadyReserved: true`；
  - 摘要不同：`IDEMPOTENCY_KEY_CONFLICT`。

## 5. 预占事务 `reserveOrder`

在 `db.runTransaction` 内：

1. 按 `_id` 创建/读取 `order_idempotency`；
2. 读取 `slot_plans` 与 ≤20 个 `inventory_plans`；
3. 校验：
   - `slot.reservedOrders + slot.paidOrders + 1 <= slot.capacity` 且 `!slot.isClosed`；
   - 每个 SKU：`plan.reservedUnits + plan.soldUnits + quantity <= plan.plannedStock`；
   - 营业状态与时间规则；
4. 更新：
   - `order_reservations` 创建为 `state=reserved`；
   - 每个 `inventory_plans.reservedUnits += quantity`，`version+1`；
   - `slot_plans.reservedOrders += 1`，`version+1`；
   - 创建订单，`settlementState=unsettled`；
   - 写 `order_events(order.reserved)`；
5. 不生成取货码；
6. 任一条件更新失败：抛 `RESERVATION_CONFLICT` 重试；数据不变量失败：抛结构化异常。

## 6. 结算事务 `settleReservationOnce`

所有取消、超时、支付回调/查单复用该入口（协议见 `order-concurrency-protocol.md` §4.2）。

### 6.1 `reserved -> settled_paid`

对预占记录中的每行：

- 校验 `plan.reservedUnits >= quantity`，不成立抛 `ANOMALY_NEGATIVE_RESERVED_UNITS`；
- 更新 `reservedUnits -= quantity`、`soldUnits += quantity`、`version+1`。

时段：

- 校验 `slot.reservedOrders >= 1`；
- 更新 `reservedOrders -= 1`、`paidOrders += 1`、`version+1`。

同时更新订单、预占记录、`payment_attempts.settlementState`、取货码字段、`order_events/audit_logs`。

### 6.2 `reserved -> released_cancelled/released_timeout`

- 每行校验 `plan.reservedUnits >= quantity`，更新 `reservedUnits -= quantity`；
- 时段校验 `slot.reservedOrders >= 1`，更新 `reservedOrders -= 1`；
- 更新订单关闭字段、预占记录终态、`settlementState/orderSettledAt`、`order_events/audit_logs`；
- 若此时已有资金事实，不释放，走 `paid_refund_pending`（见决策表）。

### 6.3 异常检测

事务内任何计数将小于 0、预占记录缺失、状态组合非法时：

1. 抛结构化错误 `{ requestId, orderId, anomalyCode, expected, actual, version }`；
2. **不在事务内写 `ops_alerts`**；
3. 事务外层捕获后单独写 `ops_alerts`；若告警写失败，写结构化 `console.error` 日志；
4. 异常路径不写 `audit_logs/order_events`。

### 6.4 退款后的库存调整（P3 前补充账本）

退款不直接反向修改原 `order_reservations` 或已结算计数。PRD 允许按生产阶段决定是否回补库存，因此新增独立调整账本：

- 集合 `inventory_movements`，唯一 `movementId`，字段：
  - `orderId / refundTaskId / skuId / storeId / businessDate`
  - `direction`：`restock / no_restock`
  - `quantity`
  - `productionStatusAtRefund`、`ruleVersion`、`decidedBy`
  - `createdAt / version`
- 退款成功事务内按 `refund_tasks.refundReason` 决定 movement：
  - `order_refund`：按生产阶段规则创建 `restock` 或 `no_restock` movement；`restock` 同事务更新对应 `inventory_plans.soldUnits -= quantity` 并校验不为负；
  - `late_payment_after_close`：**永远不创建 `restock`**，库存已在订单关闭时释放；
  - `duplicate_charge`：**永远不创建任何 movement**，主交易库存不受重复扣款退款影响。
- `inventory_plans` 对账公式同步调整为：
  - `soldUnits = SUM(settled_paid 预占 quantity) - SUM(restock movements quantity)`。
- 同一退款任务只允许一条 movement，幂等键 `movementId = movement_<refundTaskId>_<skuId>`。
- 时段容量是否回补按业务规则另行定义，P3 前只冻结库存 movement 账本，不实现自动退款。

## 7. 对账

### 7.1 日库存对账

每日任务按 `(storeId, businessDate, skuId)` 汇总：

- `SUM(reserved 状态预占记录的 quantity)` 应等于 `inventory_plans.reservedUnits`；
- `SUM(settled_paid 状态预占记录的 quantity) - SUM(restock movements quantity)` 应等于 `inventory_plans.soldUnits`；
- 任一项不一致：写 `ops_alerts`，冻结对应 SKU/日期继续售卖，人工核对。

### 7.2 时段对账

- `SUM(reserved 状态预占记录)` 应等于 `slot_plans.reservedOrders`；
- `SUM(settled_paid 状态预占记录)` 应等于 `slot_plans.paidOrders`。

### 7.3 变更后抽查

- 每次结算事务完成后，异步检查该订单涉及的 `inventory_plans/slot_plans` 是否与预占记录一致；
- 抽查失败同样冻结并告警，不依赖每日任务兜底。

## 8. 迁移

- 当前 `products.plannedStock/soldStock/reservedStock` 是 demo 全局计数，**不得直接导入生产**；
- P5 初始化：
  1. 创建单店 `store`；
  2. 店长确认未来 7/14/30 天的 `inventory_plans.plannedStock`；
  3. 按营业日历生成 `slot_plans`；
  4. 初始化 `order_reservations` 只导入“仍有效且能对应到日库存”的未完成订单，逐单校验，失败进人工队列；
  5. 初始化后跑 §7 对账，不一致不得开售。
- tourist/demo 本地订单不迁移为生产数据。

## 9. demo 模式镜像

- 本地 `demoState` 使用相同集合形状：`stores/inventoryPlans/slotPlans/orderReservations/inventoryMovements/orders/orderEvents/auditLogs`；
- 复用纯函数 `applyReservation/applySettlement`；
- demo 只能模拟最终语义，不证明跨 WebView/设备并发原子性；
- demo 的超时释放仍在入口处模拟，但必须走同一纯函数，不允许复制一套计数扣减逻辑。

## 10. 验收

- 同一幂等键并发创建只产生一单；
- 重复行合并、0/负数/小数/超大数量、>20 行、>30 件、单行 >10 均拒绝；
- 最后一件库存与最后一个时段名额并发竞争只成功一单；
- 计数将变负时事务回滚、独立 `ops_alerts` 存在、无成功审计；
- 超时任务重跑不重复释放；
- 日库存/时段对账能发现人工改数并告警；
- 退款回补通过 `inventory_movements` 独立记账，不反向修改原预占记录；
- 全局 demo 库存未直接进入生产。
