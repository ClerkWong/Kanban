# 登入與使用者管理 — 實作計畫

- 日期：2026-08-04
- 對應規格：[`2026-08-04-login-user-management-design.md`](../specs/2026-08-04-login-user-management-design.md)
- 發布目標：staging Worker + private Beta；不部署 production

## 執行項目

1. [x] 新增 email、password credential、session、login attempts 與 Workspace audit migration。
2. [x] 實作 password hashing、登入失敗限制、session 核發／驗證／登出與到期檢查。
3. [x] 實作 admin 使用者列表、建立、更新、停用與密碼重設 API。
4. [x] 保留 personal token 相容，Runtime Session 增加 `session` token kind。
5. [x] 建立 Web／Mobile 共用登入頁與本機模式入口；登入失效時安全清除本機 session。
6. [x] 平台管理加入使用者分頁、帳號統計、建立與管理對話框。
7. [x] 建立 Project 與加入 Project 成員改用同 Workspace 使用者選單。
8. [x] 完成 client、Worker、migration、lint、typecheck、Web／Mobile build 與 staging dry-run。
9. [x] 套用 staging migration、部署 Worker 與 private Beta。
10. [ ] 以既有 owner personal token 設定 owner email／密碼，再驗證密碼登入、建立 member、
    加入 Project、停用與 session 撤銷。

## 不在本階段

- Production deployment。
- 自助忘記密碼 email、email 驗證、MFA、SSO／外部 OAuth。
- 使用者跨 Workspace 搬移或合併帳號。

## 發布證據

- staging D1 migration `0004_password_login_and_user_admin.sql` 已套用，無 pending migration。
- staging Worker version `cfdb5306-29e9-4664-86dc-a426a899bc64` 已部署；authenticated
  smoke 通過，`GET /admin/users` 回 200，無效登入回安全的 401。
- private Sites Beta v8 已從 `f99ac402eda2c24df5a2988834c5e72e2d0f573e` 發布，保留
  owner-only access；production Worker／D1／R2 未變更。
- 169 個 client/domain tests、53 個 Worker runtime tests、lint、typecheck、Web／Mobile
  build、generated Worker types、fresh 0001→0004 migration 與 staging dry-run 全數通過。
