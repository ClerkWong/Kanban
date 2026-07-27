# Personal token 生命週期 Runbook

最後更新：2026-07-27

## 原則

- 一人一身份、一台裝置一枚 personal token；禁止多人或多裝置長期共用 token。
- token 明文至少 32 個不含空白的高熵字元，只在建立時輸入裝置與密碼管理器。
- D1 只存 SHA-256 hash；維運輸出只允許 token ID、label、kind 與時間，不輸出明文
  或 hash。
- `sync:token` 不接受 `--token`，create 從隱藏 TTY 或 stdin 讀取；production 操作另須
  `--confirm-production`。
- token rotation 不改 user ID、Workspace role、Project memberships 或 Activity Log
  actor。
- 先建立並驗證替代 token，再撤銷舊 token；撤銷不可用「先刪後補」。

## 1. 建立 token

User account 必須先存在且為 `active`。初始 Workspace owner 使用
`pnpm sync:bootstrap`；一般 user 的建立流程見
[multi-project-staging.md](./multi-project-staging.md)。

由密碼管理器產生 token 並安全保存，透過隱藏提示輸入：

```bash
pnpm sync:token -- create \
  --target staging \
  --user-id "USER_UUID" \
  --label "alice-iphone"
```

Label 應能辨識人員與裝置，但不要放 email、token 片段或其他敏感資訊。命令成功只會
顯示新 token ID；把 token ID、user ID、label、建立日期與保管人寫入受控 inventory。

用新 token 驗證：

1. `GET /me` 是預期 user 且 `tokenKind=personal`。
2. 「我的專案」只列出該 user 的 memberships。
3. manager/contributor/viewer 權限符合預期。
4. Worker log 沒有 Authorization header、token 或 token hash。

## 2. 列出 token metadata

```bash
pnpm sync:token -- list \
  --target staging \
  --user-id "USER_UUID"
```

輸出刻意不查詢 `token_hash`。以 `id`、`label`、`created_at`、`last_used_at` 與
`revoked_at` 對照 inventory。`last_used_at` 只用於調查，不可當成 token 所有人身份的
唯一證據。

## 3. 撤銷 token

撤銷前核對 target、user ID、token ID 與 label。若是輪替，必須先完成新 token 驗證：

```bash
pnpm sync:token -- revoke \
  --target staging \
  --user-id "USER_UUID" \
  --token-id "TOKEN_UUID"
```

撤銷命令只更新該 user 的一枚 active personal token；錯 user、已撤銷 token 或 legacy
token 會失敗，不會批次撤銷。完成後驗證：

- 舊 token 對 `/me` 回 401；
- 新 token 仍回 200；
- Project memberships、Board revision 與本機資料未改變；
- inventory 記錄撤銷時間、原因、執行人與驗證結果。

Production 使用同樣流程時，每個命令都必須加 `--confirm-production`，並由第二人核對
target 與 token ID。

## 4. 正常輪替

1. 以新的 device-specific label 建立 token。
2. 在一台裝置設定新 token，驗證 `/me`、Project list、讀取與允許的 mutation。
3. 逐台裝置切換；不要把舊 token 複製到新裝置。
4. 檢查 attachment queue 已無等待中的舊 endpoint/token context。
5. 撤銷舊 token。
6. 驗證舊 token 401、新 token 200，觀察 Worker errors。
7. 更新 inventory；不得保留舊 token 明文作「備用」。

若 user 使用 Web、iOS、Android，應分別輪替，任一枚洩漏不必撤銷其他健康裝置。

## 5. 裝置遺失或疑似洩漏

1. 立即從 inventory 找出該裝置 token ID；不等待裝置上線。
2. 執行 revoke，驗證舊 token 401。
3. 檢查該 token 的 `last_used_at`、相關 Worker request IDs 與 Project Activity Log。
   不把 log actor 當成裝置持有者的絕對證明。
4. 若無法確定是哪一枚，撤銷該 user 所有 active personal tokens，再逐裝置換發。
5. 若懷疑 shared legacy token，先為合法 user 建立並驗證 personal tokens，再依 client
   replacement 流程撤銷 legacy token。
6. 記錄事件時間線、影響 Project、撤銷 token IDs 與後續監控；不得記錄 token/hash。

如果裝置仍有未同步本機資料，撤銷後資料會留在該裝置，不會自動上傳。找回裝置後，
由管理者判斷是否重新授權並人工合併；不可為了取回資料而恢復已洩漏 token。

## 6. 成員離開或權限撤回

1. 各 Project manager 先移除該 user memberships；最後 manager guard 必須保持通過。
2. 撤銷該 user 全部 active personal tokens。
3. Workspace owner/admin 將 `user_accounts.status` 改為 `disabled`；不要刪 user row，
   以保留歷史 Log actor。
4. 驗證所有舊 token 401、未參與 Project 不可猜測內容。
5. 不刪除歷史 Activity Log、Board 或附件作為「撤權」手段。

## 7. 失敗與回復

- create 失敗：舊 token 不受影響；修正 active user、D1 binding 或連線後重試。
- 新 token 驗證失敗：不要撤銷舊 token，先確認 target、user 與 token 是否正確。
- revoke 指向錯誤 ID：命令會因沒有恰好更新一列而失敗；重新執行 list 核對。
- 誤撤銷：不可解除撤銷；建立新 token 並重新設定裝置。
- D1/Worker 不一致：停止輪替與部署，保存 request ID，依 staging/production 事故流程
  處理，不直接編輯 token hash。

## 8. 定期稽核

至少每季或每次 release：

- active token 都有 owner、device 與合理 label；
- 離職、遺失、停用與長期未用 token 已撤銷；
- 沒有 active legacy/shared token；
- disabled user 沒有可通過 `/me` 的 token；
- repo、bundle、CI artifacts、`.wrangler` logs 與 ticket 不含 token/hash；
- production token 操作有第二人覆核與完整的非敏感 inventory。
