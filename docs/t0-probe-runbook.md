# t0-probe 动态证据执行 Runbook（第七轮定向修订后）

> 状态：探针与执行顺序已按第七轮定向意见修订，**待复审**；动态执行仍需测试环境登录态。复审通过前不部署。
> 配套：`wechat-miniprogram/cloudfunctions/t0-probe/README.md`、`docs/t0-spike-evidence.md`。

## 0. 前置条件与门禁配置

1. 独立微信云开发**测试环境**，与生产/正式体验环境隔离；
2. 执行人已登录微信开发者工具或 CloudBase CLI；
3. 不在本仓库写入真实环境 ID、SecretId/SecretKey、API Key、operator token；
4. 记录 CLI 来源和版本：

```bash
tcb --version
# 若 tcb 不在 PATH：
npm exec --yes --package=@cloudbase/cli@3.7.3 -- tcb --version
```

5. 生成一次性 operator token（仅存于安全位置，不进仓库）：

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

6. 模板保持 fail-closed；复制为本地 `cloudbaserc.json` 后再设置：
   - `envId` = 测试环境 ID；
   - `T0_PROBE_ENABLED` = `"true"`（执行期间临时开启）；
   - `T0_PROBE_ENV_ID` = 测试环境 ID；
   - `T0_PROBE_OPERATOR_TOKEN` = 上面生成的随机 token。

CloudBase 原生 Timer 配置无法安全注入 secret `Message`，因此主 `t0-probe` 不提供 Timer 免鉴权路径；`Type/TriggerName/Message/Time` 不是主函数 action 的允许输入键，即使携带 operator token 也会被拒绝。T0-D08 最后部署独立最小 `t0-probe-timer` 函数验证。

## 1. 部署、建集合与索引（本阶段不开 Timer）

固定顺序：**部署且不开 Timer → `status` → `setup` 创建集合/种子 → 创建索引并等待 ready → `preflight`**。CLI 与开发者工具二选一；Timer 留到 §2.6 最后创建。

### 1.1 CloudBase CLI 路径

```bash
cd wechat-miniprogram/cloudfunctions/t0-probe
cp cloudbaserc.example.json cloudbaserc.json
# 编辑 cloudbaserc.json 填入真实测试环境 ID 与 operator token；执行后不提交该文件
tcb login
tcb fn deploy t0-probe --force --install-dependency true --json
tcb fn detail t0-probe -e <TEST_ENV_ID> --json
# 此时 detail 中必须没有 t0probe-timer；不得提前创建触发器
```

### 1.2 微信开发者工具路径

1. 导入 `wechat-miniprogram`；
2. 在控制台为 `t0-probe` 配置三项门禁环境变量、超时 ≥ 60 秒、内存 512 MB；
3. 右键“上传并部署：云端安装依赖”，本阶段不部署独立 `t0-probe-timer` 函数，也不为主函数创建 Timer 触发器；
4. 部署后检查触发器列表，必须没有 `t0probe-timer`。

### 1.3 先执行 `status` 与 `setup`

```bash
export T0_ENV=<TEST_ENV_ID>
export T0_TOKEN=<OPERATOR_TOKEN>
mkdir -p artifacts/t0

tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"status\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-SDK-status.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"setup\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-SETUP.json
```

`status` 和 `setup` 都必须通过；`setup` 负责先创建集合与基线数据，避免在不存在的集合上创建索引或运行 preflight。

### 1.4 创建索引并等待 ready

按 `wechat-miniprogram/cloudfunctions/t0-probe/indexes.json` 在控制台创建 4 条索引并截图：

- `t0probe_orders(customerOpenId ASC, status ASC, createdAt ASC, _id ASC)`
- `t0probe_orders(status ASC, expiresAt ASC, paymentCheckDueAt ASC)`
- `t0probe_attempts(terminal ASC, channelStatus ASC, settlementState ASC, settlementReviewState ASC, settlementNextRetryAt ASC)`
- `t0probe_unique_conflict(merchantOrderNo ASC)` **唯一索引**

每条索引必须等待控制台状态变为 `ready/可用` 并截图，不能只记录“创建请求成功”。唯一索引就绪后才执行 D05。

### 1.5 执行 preflight 总闸门

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"preflight\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D00-preflight.json
```

preflight 分三条路径记录：

- `official-doc`：公开 `tx.collection().doc().get/update()`，是 T0 正式通过与 D01/D02/D04/D09 的基础；
- `official-where`：公开 `tx.collection().where().update()` 的兼容性诊断，不作为正式通过前提；
- `raw-diagnostic`：SDK 私有请求路径，仅用于定位，禁止成为生产实现候选。

仅当 `data.summary.pass === true`、`data.officialDocUpdate.pass === true` 且 `data.officialDocGetUpdateRace.pass === true` 时继续正式证据采集。`official-where` 或 `raw-diagnostic` 失败应保留证据，但不会覆盖 `official-doc` 结论。

## 2. 执行

统一使用 JSON 参数，所有命令携带 `operatorToken` 和 `envId`；原始返回保存到 `artifacts/t0/`（该目录已加入 `.gitignore`）。

### 2.1 T0-D01：barrier 先建订单种子，再发两个独立请求

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"barrier\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"key\":\"race-001\",\"participants\":2,\"leadMs\":5000}" --json | tee artifacts/t0/T0-D01-barrier.json

tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d01\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"key\":\"race-001\",\"caller\":\"A\",\"participants\":2,\"method\":\"official-doc\",\"maxRetries\":5}" --json > artifacts/t0/T0-D01-A.json 2>&1 &
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d01\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"key\":\"race-001\",\"caller\":\"B\",\"participants\":2,\"method\":\"official-doc\",\"maxRetries\":5}" --json > artifacts/t0/T0-D01-B.json 2>&1 &
wait

tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d01_verify\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"key\":\"race-001\"}" --json | tee artifacts/t0/T0-D01-verify.json
```

`barrier` 必须在 arm 屏障前完成 D01 订单种子创建；D01 请求不得自行补种或覆盖订单。`participants >= 2`，到达计数按不同 `caller` 去重，相同 caller 不能填满屏障。

判定：两份 `d01` 返回均为 `pass:true`，`d01_verify.pass:true`，且 verify 显示恰好一个 active attempt、一个 `merchantOrderNo`。`official-where` 和 `raw-diagnostic` 只用于定位，不作为正式证据路径。

### 2.2 T0-D02–D05

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d02\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"method\":\"official-doc\"}" --json | tee artifacts/t0/T0-D02.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d02\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"method\":\"official-doc\",\"rollback\":true}" --json | tee artifacts/t0/T0-D02-rollback.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d03\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D03.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d04\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"mode\":\"direct\"}" --json | tee artifacts/t0/T0-D04.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d04\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"mode\":\"transaction\",\"method\":\"official-doc\"}" --json | tee artifacts/t0/T0-D04-transaction.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d05\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D05.json
```

### 2.3 T0-D06、D07、D09

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d06\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"budget\":40,\"maxSearch\":256}" --json | tee artifacts/t0/T0-D06.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d07\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"marker\":\"run-001\"}" --json | tee artifacts/t0/T0-D07.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d09\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"mode\":\"direct\"}" --json | tee artifacts/t0/T0-D09.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d09\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\",\"mode\":\"transaction\"}" --json | tee artifacts/t0/T0-D09-transaction.json
```

D06 分开记录：`budgetPass` 只证明项目预算 40 可执行；`limitCharacterized` 只有同时观察到成功边界与首个失败边界才为真。搜索达到 `maxSearch` 只能得到“预算通过、平台上限未测明”，不能宣称上限已确认。

### 2.4 T0-D10–D12

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d10\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D10.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d11\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D11.json
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d12\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D12.json
```

T0-D10 在控制台对三条复合索引执行相同条件查询并截图 EXPLAIN/查询计划。T0-D11 在控制台截图 VPC/出口限制/WAF 配置能力。

D10 每次 action 使用独立、稳定的专用种子；时间样本相对同一基准设置为远离执行窗口的过去/未来值，断言结果不得依赖 `setup` 后已经过去多少分钟。

D12 先写入带请求 ID 的结构化安全日志，再返回/保存证据；发现污染时以日志为主证据，并销毁当前函数实例。不能依赖“返回后延迟 `process.exit`”保证响应已经送达。D12 执行后须重新调用 `status`，证明后续请求运行在干净实例；若无法证明，停止其他动作并直接清理函数。

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"status\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D12-post-status.json
```

### 2.5 执行 manual smoke（不计入 D08 通过）

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"d08\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-D08-manual-smoke.json
```

手工调用只验证 action 可达，必须返回 `manual-smoke` 且 `pass:false`。

### 2.6 最后部署独立 Timer 函数并验证 T0-D08

1. 复制独立函数的 `cloudbaserc.example.json` 后，仅在临时本地配置中把 fail-closed 默认值 `T0_PROBE_ENABLED="false"` 改为 `"true"`；部署独立最小 `t0-probe-timer` 函数。它只接受官方 Timer 事件结构，只允许向 `t0probe_timer_log` 写标记，不复用主函数的 action 分发和 operator-token 免鉴权分支；
2. CLI 路径在函数部署成功后单独创建 `t0probe-timer`；开发者工具路径使用独立函数的 `config.json` 创建。两条路径二选一，cron 均为 `0 */5 * * * * *`；
3. 保存函数源码快照、最终函数配置与触发器定义，确认只有一个同名触发器且目标为 `t0-probe-timer`；
4. 等待真实 Timer 周期，用 `tcb fn log t0-probe-timer -e "$T0_ENV"` 保存平台真实触发请求日志；
5. 通过 CloudBase 控制台数据库查询核验 `t0probe_timer_log` 标记。marker 只作佐证，平台触发日志和触发器配置是主证据；
6. 以普通 invoke 对主 `t0-probe` 伪造 `Type:"Timer"`、`TriggerName:"t0probe-timer"`，必须因未知输入键被拒绝且不得写入标记；携带 operator token 也不能绕过输入白名单。

只有“平台真实 Timer 日志与配置成立 + marker 佐证写入 + 主函数伪造 Timer 无法免鉴权”才可判 T0-D08 通过。

## 3. 证据回填

逐项回填 `docs/t0-spike-evidence.md` §4。归档前检查每份原始 JSON：

- 无真实 `operatorToken`、SecretId/SecretKey/API Key；
- 环境 ID 已脱敏；
- `meta.versions`、`error.stack/raw error` 保留；
- 失败项明确写“替代方案或协议回写”。

## 4. 清理与清后核验

```bash
tcb fn invoke t0-probe -e "$T0_ENV" --params "{\"action\":\"cleanup\",\"envId\":\"$T0_ENV\",\"operatorToken\":\"$T0_TOKEN\"}" --json | tee artifacts/t0/T0-CLEANUP.json
# cleanup.pass 必须为 true，且每个集合 finalCount=0、bulkErrors=[]、failures=[]
```

删除函数与触发器（按部署路径二选一）：

```bash
tcb fn trigger delete t0-probe-timer t0probe-timer -e "$T0_ENV"
tcb fn delete t0-probe-timer -e "$T0_ENV"
tcb fn delete t0-probe -e "$T0_ENV"
```

随后清单式核验：

- [ ] `tcb fn detail t0-probe -e "$T0_ENV"` 返回函数不存在；
- [ ] `tcb fn detail t0-probe-timer -e "$T0_ENV"` 返回函数不存在；
- [ ] 控制台触发器列表无 `t0probe-timer`；
- [ ] 控制台索引列表无 `idx_t0probe_* / uniq_t0probe_*`；
- [ ] 控制台集合列表无任何 `t0probe_` 集合；
- [ ] `artifacts/t0/` 证据已归档，环境变量中的 operator token 已删除/轮换，`T0_PROBE_ENABLED` 已关闭或函数已删除。
