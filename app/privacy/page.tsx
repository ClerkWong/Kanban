import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "隱私說明｜本機 Kanban",
  description: "本機 Kanban 的裝置儲存、雲端同步與權限使用說明。",
};

export default function PrivacyPage() {
  return (
    <main className="legalPage">
      <p className="eyebrow">本機 Kanban</p>
      <h1>隱私說明</h1>
      <p className="legalUpdated">最後更新：2026 年 7 月 23 日</p>

      <section>
        <h2>本機資料</h2>
        <p>
          看板會先儲存在目前裝置。Web 版使用瀏覽器儲存空間，行動版使用 App
          的本機檔案空間；在未啟用同步時，資料不會送到同步服務。
        </p>
      </section>

      <section>
        <h2>選用的雲端同步</h2>
        <p>
          使用者輸入同步服務網址與 Bearer token 後，看板內容會傳送到 Cloudflare
          Worker，結構化看板資料存於 D1；啟用附件同步後，照片與錄音檔案存於 R2。同步
          token 保存在該裝置的本機儲存空間，不會寫入本專案程式碼。
        </p>
      </section>

      <section>
        <h2>相機、相簿、麥克風與語音辨識</h2>
        <p>
          App 只在使用者主動操作時要求相關權限。擷取內容會先存入本機；只有在啟用同步且
          附件屬於已儲存卡片時，才會依同步流程上傳。語音辨識由裝置提供的系統服務處理，
          實際處理方式也受作業系統供應商政策約束。
        </p>
      </section>

      <section>
        <h2>存取、刪除與撤銷</h2>
        <p>
          本服務目前採共用看板 token。請勿轉交 token；若裝置遺失、成員離開或懷疑外洩，
          應立即請發放 token 的管理者撤銷並換發。重設本機看板只會清除目前裝置資料；共用
          雲端看板、附件或整體帳號層級資料的清除，請聯絡管理者處理。
        </p>
      </section>

      <section>
        <h2>分析與廣告</h2>
        <p>
          App 目前沒有加入第三方廣告或使用者行為分析 SDK。同步服務會保留必要的系統與錯誤
          記錄以維運服務，但設計上不應記錄明文 token 或附件內容。
        </p>
      </section>

      <p>
        <Link href="/">返回看板</Link>
        {" · "}
        <Link href="/support">取得支援</Link>
      </p>
    </main>
  );
}
