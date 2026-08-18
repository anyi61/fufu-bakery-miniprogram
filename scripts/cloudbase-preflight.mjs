import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
}

const envId = process.env.CLOUDBASE_ENV_ID || "";
const hmacKey = process.env.IDEMPOTENCY_HMAC_KEY || "";
const t0EnvId = process.env.T0_PROBE_ENV_ID || "";
const t0Token = process.env.T0_PROBE_OPERATOR_TOKEN || "";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "wechat-miniprogram/cloudfunctions/deploy-manifest.json"), "utf8"));
const indexes = JSON.parse(fs.readFileSync(path.join(root, "wechat-miniprogram/business-indexes.json"), "utf8"));
const project = JSON.parse(fs.readFileSync(path.join(root, "wechat-miniprogram/project.config.json"), "utf8"));
const privateProjectPath = path.join(root, "wechat-miniprogram/project.private.config.json");
const privateProject = fs.existsSync(privateProjectPath) ? JSON.parse(fs.readFileSync(privateProjectPath, "utf8")) : {};
const effectiveAppId = privateProject.appid || project.appid;

check("production manifest", JSON.stringify(manifest.production) === JSON.stringify(["bakery", "payment"]), "只允许 bakery/payment");
check("diagnostic functions excluded", ["seed", "t0-probe", "t0-probe-timer"].every((name) => manifest.excluded.includes(name)), "seed 与 T0 不得进入生产部署");
check("business indexes", indexes.indexes.length >= 6, "库存、时段、预占、订单和员工索引");
check("real app id", effectiveAppId && effectiveAppId !== "touristappid", "必须通过未提交 Git 的本机私有配置提供");
check("CloudBase env id", /^[A-Za-z0-9_-]{3,64}$/.test(envId), "CLOUDBASE_ENV_ID 未配置或格式无效");
check("idempotency HMAC key", hmacKey.length >= 32, "IDEMPOTENCY_HMAC_KEY 至少 32 字符");
check("T0 environment binding", t0EnvId === envId && Boolean(envId), "T0_PROBE_ENV_ID 必须与专用测试环境一致");
check("T0 operator token", t0Token.length >= 32, "T0_PROBE_OPERATOR_TOKEN 至少 32 字符");

for (const item of checks) {
  process.stdout.write((item.passed ? "PASS" : "BLOCKED") + " " + item.name + " - " + item.detail + "\n");
}
if (checks.some((item) => !item.passed)) process.exitCode = 2;
