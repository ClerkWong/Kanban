# 登入與使用者管理 — 設計規格

- 日期：2026-08-04
- 狀態：Beta 實作完成，待人工驗收
- 發布範圍：staging Worker + private Sites Beta；不變更 production

## 目標

1. 一般使用者以電子郵件與密碼登入，不再需要理解或手動保存個人 Token。
2. Workspace `owner / admin` 可建立及管理登入帳號；Project 內容權限仍只由
   `owner / member / legacy viewer` membership 決定。
3. 既有 personal token 保留為管理者移轉、Mobile 相容與救援入口。

## 驗證與工作階段

- 密碼以 Web Crypto `PBKDF2-SHA512`、每帳號獨立 16-byte salt 與 Workers runtime
  目前支援上限 100,000 iterations 衍生；D1 不保存明文密碼。iteration 數集中保存，
  後續可隨 runtime 上限提升進行 credential upgrade。
- 登入成功核發 256-bit 隨機 session token；D1 只保存 SHA-256 hash，預設 30 日到期。
- 登出、停用帳號與管理者重設密碼都會撤銷相關 session；停用帳號也撤銷 personal token。
- 登入錯誤不區分帳號不存在、停用或密碼錯誤；依 email + client IP 做 15 分鐘失敗限制。
- 前端只保存目前 session token，Web 使用既有 credential storage，Mobile 使用
  Keychain／Keystore-backed storage。

## 使用者管理

- 平台管理分為「專案管理」與「使用者管理」。
- owner/admin 可建立一般使用者或平台 Admin、設定顯示名稱、email 與初始密碼。
- 可更新名稱、email、平台角色、啟用狀態及重設密碼。
- 系統主要 owner 不可由 admin 降級或停用；任何管理者不可停用或移除自己的管理權限。
- 所有使用者管理異動寫入 append-only `workspace_activity_logs`，metadata 不含密碼。

## Project 整合

- 建立 Project 時從同一 Workspace 的 active users 選擇初始 Project Owner，不再要求 UUID。
- Project Owner 加入成員時從同一 Workspace 使用者目錄選擇；不可把其他 Workspace
  的帳號加入 Project。
- Workspace admin 身分本身不授予任何 Project／Board 內容權限。

## 相容與限制

- 尚未設定 email／密碼的既有 owner 先以 personal token 登入，再到使用者管理設定自己。
- personal token API 與 legacy token 換發在此 Beta 保留；新一般使用者預設只使用密碼登入。
- 忘記密碼目前由平台管理者重設；自助 email reset／MFA／外部 IdP 不在此階段。
