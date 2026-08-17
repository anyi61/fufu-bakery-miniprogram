# T0 SDK 安全审计报告（冻结前必读）

> 状态：初步报告，随 T0 spike 补完可达性与 override 回归后给出最终处置结论
> 基线：`wx-server-sdk 4.0.2`，三个云函数 lockfile 均已生成
> 审计命令：`npm audit --package-lock-only`，结果：npm audit 报告 6 个受影响节点/依赖项（5 high、1 moderate）。其中 5 个是具体依赖包，第 6 个是顶层聚合节点 `wx-server-sdk`；底层风险主要由 `axios/lodash` 链路造成，不表示 6 个独立 CVE。

## 1. 结论（当前）

- 不采用 npm 建议的自动降级到 `wx-server-sdk 2.5.3`：降级可能破坏事务 API 和现有调用兼容性。
- 保持 `wx-server-sdk 4.0.2`，但 **T0 未完成本节全部处置前不得冻结 T0、不得进入 T1、不得用于生产**。
- 最终处置结论必须包含：可达性证据、override 回归结果、缓解措施、风险接受人和生产上线硬门槛。

## 2. 受影响依赖

| 依赖 | 版本 | 严重度 | 风险摘要 |
|---|---|---|---|
| `axios` | 0.27.2 | high | SSRF、凭据泄露、原型污染、请求/响应劫持、DoS |
| `lodash.set` | 4.3.2 | high | 原型污染 |
| `lodash.unset` | 4.5.2 | high | 原型污染 |
| `@cloudbase/database` | 1.4.3 | high（传递） | 经 `lodash.set/unset` 原型污染 |
| `@cloudbase/node-sdk` | 3.17.2 | high（传递） | 经 `@cloudbase/database` 与 `axios` 受影响 |
| `wx-server-sdk` | 4.0.2 | high（聚合节点） | 顶层依赖，风险来自上述传递链路，不是独立 CVE |

依赖路径：

```text
wx-server-sdk@4.0.2
└── @cloudbase/node-sdk@3.17.2
    ├── @cloudbase/database@1.4.3
    │   ├── lodash.set@4.3.2
    │   └── lodash.unset@4.5.2
    └── axios@0.27.2
```

## 3. 可达性初步判断与待验证项

本地静态证据已采集并记录于 `docs/t0-spike-evidence.md` §1：业务源码无直接 axios/lodash.set/unset 调用；axios 位于 `@cloudbase/node-sdk` 的 metadata 查询与通用 HTTP 请求器；lodash.set/unset 位于 `@cloudbase/database` 的实时数据库虚拟 WebSocket 路径。

| 漏洞 | 当前代码路径初步判断 | T0 spike 必须验证 |
|---|---|---|
| axios SSRF/凭据泄露 | 业务云函数未直接 `require("axios")`，且当前只调用 `cloud.database()`、`cloud.getWXContext()`；但 `@cloudbase/node-sdk` 内部 HTTP adapter 可能使用 axios | 追踪 SDK 数据库/鉴权/存储调用是否发起 HTTP；确认是否有任何用户可控 URL/Host 进入 axios |
| axios 原型污染/DoS | 取决于 SDK 是否合并不可信对象；云函数会处理用户 `event` 与数据库返回数据 | 验证事务/查询/更新 payload 的 merge 路径；构造 `__proto__/constructor` 输入回归；若观察到污染，先保存带请求 ID 的结构化安全日志，再销毁实例并验证后续请求运行在干净实例 |
| lodash.set/unset 原型污染 | 需要 SDK 调用路径经过受影响函数且 key 可控 | 动态/静态确认 `@cloudbase/database` 使用位置与 key 来源 |
| 生产环境实际运行方式 | 云函数由微信托管，网络出口与运行环境不完全等于本地 Node | 在测试云函数中打印依赖版本并执行最小事务/查询回归 |

**新增静态发现（待动态证实）**：`wx-server-sdk@4.0.2` 依赖的 `@cloudbase/database@1.4.3` 中，`Query.update()` 发送 `database.modifyDocument` 时未携带 `transactionId`。preflight 将路径拆成：公开 `tx.doc().get/update()` 的 `official-doc` 正式路径、公开 `tx.where().update()` 的 `official-where` 兼容诊断，以及 SDK 私有请求的 `raw-diagnostic`。T0 正式通过只以 `official-doc` 为基础；后两者不得进入生产协议。这属于 SDK 能力缺口调查，不是 CVE 漏洞，但必须与安全审计一并形成处置结论。

Timer 动态可达性由最后部署的独立最小 `t0-probe-timer` 验证。CloudBase 原生 Timer 无法安全注入 secret `Message`，主 `t0-probe` 因此不接受 Timer 字段；独立函数只接受精确官方四字段事件并写幂等 marker。D08 以平台真实触发日志与触发器配置为主证据，数据库 marker 只作佐证。

## 4. 可选处置方案

1. **保持 4.0.2 + 缓解**：无直接 axios 使用、云函数最小权限、禁止不可信 URL 进入 SDK、VPC/出口限制、WAF/审计告警、每月 `npm audit`。**其中 VPC、出口限制、WAF 必须先证明微信云开发环境实际可用，未验证前只能列为候选缓解，不能作为既定缓解。**
2. **安全 override 传递依赖**：在独立分支和临时 lockfile 中尝试将 `axios` 提升到已修复版本，并保持 `@cloudbase/node-sdk@3.17.2`；必须完成事务、数据库查询、鉴权、定时触发器回归，回归通过前不得让临时 override 进入三套正式云函数 lockfile。不直接执行 npm 建议的降级。
3. **上游升级**：跟踪 `wx-server-sdk` 新版本是否升级 `@cloudbase/node-sdk/axios`；发布后重新审计并升级。
4. **隔离部署**：支付/订单云函数与静态资源/第三方 SDK 隔离，减少单点影响。

## 5. 临时缓解与风险接受

- 云函数仅使用数据库 API，业务代码不直接发起 HTTP 请求；新增 HTTP 调用必须评审。
- 所有进入云函数的 `event/input` 视为不可信，禁止原样传入 SDK 深合并路径；P1 输入校验先行。
- 生产环境开启云函数日志、告警和数据库审计。
- 风险接受人：门店经营负责人 + 技术负责人（正式上线前签字，T0 只登记角色）。
- 不接受“npm audit fix 自动降级”作为修复方案。

## 6. 生产上线硬门槛

- [ ] T0 spike 完成 §3 全部可达性验证并形成证据；
- [ ] 若采用 override，事务/数据库/鉴权/定时器全量回归通过；
- [ ] 若保持 4.0.2，缓解措施已部署且审计可见；
- [ ] 风险接受人已签字；
- [ ] 建立上游升级跟踪：每月 `npm audit`，关注 `wx-server-sdk` release 与 GHSA 公告；
- [ ] 上线前最后一次审计为 0 个未处置 high 漏洞，或每个未修复 high 均有书面风险接受。

## 7. 记录更新

- 本报告随 T0 spike 更新为最终版；最终版通过后 T0 方可冻结。
- 三个云函数的 `package-lock.json` 当前为已生成状态，随 T0 冻结评审通过后统一提交。
