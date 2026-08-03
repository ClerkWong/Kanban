# 平台管理與單一專案看板 — 設計規格

- 日期：2026-08-03
- 狀態：已核准並進入實作
- 取代：多看板建立流程與對外 `manager / contributor` 角色名稱

## 核准決策

1. 一個 Project 固定對應一個使用中 Board，兩者名稱彼此獨立。
2. 平台 `admin` 可建立、封存 Project、指定初始 owner，並查看管理 metadata；除非另有
   Project membership，否則不得查看 Board、Card、Attachment、Report 或 Log。
3. Project `owner` 可由多人共同擔任，但每個 Project 至少保留一位有效 owner。
4. Project `member` 可查看、建立、編輯、移動、指派任務及處理附件，不能管理 Project
   設定或成員。
5. 舊 `viewer` membership 保留唯讀，不可新增；owner 可將其明確升級為 member。
6. 建立 Project 必須原子建立 Project、唯一 Board、初始 owner 與 audit events。
7. 既有多看板 Project 保留最近更新的一個 active Board；其餘 Board 轉為 archived
   history，不刪內容與 Log。
8. 從「我的專案」直接進入該 Project 的 Board；owner 另有專案與成員管理入口。

## 角色矩陣

| 能力 | admin | owner | member | legacy viewer |
| --- | --- | --- | --- | --- |
| 建立／封存 Project | 是 | 否 | 否 | 否 |
| 查看未加入 Project metadata | 是 | 否 | 否 | 否 |
| 查看 Board／Card／附件／Log | 僅加入後 | 是 | 是 | 是 |
| 編輯與指派任務 | 僅加入後 | 是 | 是 | 否 |
| 管理 Project 名稱／Board 名稱 | 否 | 是 | 否 | 否 |
| 管理 owner／member | 否 | 是 | 否 | 否 |

`admin` 是 Workspace 管理軸；`owner / member / viewer` 是 Project 內容授權軸，兩者不可
互相推導。

## 相容策略

- D1 既有 `manager / contributor / viewer` 值暫不破壞性重建；Worker API 邊界映射為
  `owner / member / viewer`。
- API 不接受新增 `viewer`，但會回傳既有 viewer 供 owner 辨識與升級。
- D1 partial unique index 保證每個 Project 最多一個 active Board。
- archived history 可讀，不可還原成第二個 active Board。
- production 不在本規格的 beta 驗證完成前變更。
