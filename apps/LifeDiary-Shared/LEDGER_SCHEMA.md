# LifeDiary 独立账本（Ledger）Schema

独立账本是 LifeDiary 的一等公民原生目的地：在 life 应用内以 `LedgerView` 呈现，并作为独立的交换域与服务器同步。

## 交换域（exchange domain）

- exchange domain：ledger
- 全局唯一，不与 diary / community / health 等其它域混用。

## 同步契约

- 同步接口：`syncLedger(entries)`
- 鉴权：走 LifeAuth 会话（`LifeAuth.getSession()` + `LifeAuth.authFetch(...)`），不依赖网页 passport 的 `zz_passport_token` 明文。
- 离线优先：本地写入后立即在队列中标记为待同步，待联网后回放。

## 数据字段

| 字段 | 类型 | 说明 |
|------|------|------|
| category | string | 分类（支出 / 收入 / 转账，未命中已知分类回退 `other`） |
| amount | number | 金额（单位：元，保留两位小数） |
| note | string | 备注 |
| timestamp | number | 毫秒时间戳 |

## 导入导出

- 导出：`lifediary-ledger.json`（schemaVersion=1, product=LifeDiary, domain=ledger, entries[]）
- 导入：校验 schemaVersion / product / domain，逐条规整 category 后并入本地。
