# 平台管理與單一專案看板 — 實作計畫

- 日期：2026-08-03
- 對應規格：[`2026-08-03-project-admin-owner-member-design.md`](../specs/2026-08-03-project-admin-owner-member-design.md)
- 發布目標：staging Worker + private Beta；不部署 production

## 執行項目

1. [x] 將 Client 對外角色改為 `owner / member / viewer`，保留 viewer 唯讀相容。
2. [x] Worker 在 API 邊界映射既有 D1 role，維持 server-side authorization。
3. [x] `POST /projects` 原子建立 Project、唯一 Board、初始 owner 與兩筆 audit。
4. [x] Admin registry 回傳 owner 與單一 Board metadata，不回傳工作內容。
5. [x] D1 `0003` 封存既有額外 active Boards，加入 one-active-Board unique index。
6. [x] Board API 阻止建立第二個 active Board及封存唯一 active Board。
7. [x] Admin 建立表單加入 Board 名稱與初始 owner；owner/member 管理 UI 移除新 viewer。
8. [x] 「我的專案」直接進入 Board，owner 保留專案／成員管理入口。
9. [ ] 完整 client／Worker／migration／lint／typecheck／build 驗證。
10. [ ] 套用 staging migration、部署 staging Worker 與 private Beta smoke test。

## 驗收條件

- 建立成功後 D1 同時存在一個 Project、一個 active Board 與至少一位 owner。
- 建立 audit 任一步失敗時整批回滾。
- admin 指定別人為 owner 時不會自動取得 Board 讀取權。
- 同 Project 無法建立或還原第二個 active Board。
- 最後一位有效 owner 無法降級或移除。
- member 可編輯任務與多人指派，但看不到成員管理操作。
- 舊 viewer 仍可讀取，不能編輯，也不能再被新增。
