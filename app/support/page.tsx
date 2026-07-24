import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "支援｜本機 Kanban",
  description: "本機 Kanban 的同步、離線與權限問題排解方式。",
};

export default function SupportPage() {
  return (
    <main className="legalPage">
      <p className="eyebrow">本機 Kanban</p>
      <h1>支援</h1>
      <p>
        本服務目前為內部使用版本。需要換發 token、清除共用雲端資料或回報問題時，請聯絡
        當初提供同步網址與 token 的管理者。
      </p>

      <section>
        <h2>同步失敗</h2>
        <ol>
          <li>確認裝置已連線，並回到 App 前景。</li>
          <li>開啟「同步」設定，確認網址與 token 沒有多餘空白。</li>
          <li>按「立即同步」重試；若顯示憑證無效，請向管理者申請新 token。</li>
          <li>不要為了解決同步問題而重設看板；離線變更會先保留在本機。</li>
        </ol>
      </section>

      <section>
        <h2>附件無法載入</h2>
        <p>
          先確認網路，再讓 App 保持在前景並重試同步。仍無法載入時，請記錄卡片名稱、附件
          類型、發生時間與使用裝置；不要把同步 token 放進截圖或問題描述。
        </p>
      </section>

      <section>
        <h2>相機、錄音或語音輸入不可用</h2>
        <p>
          到 iOS 或 Android 的系統設定確認本 App 已取得相機、照片、麥克風與語音辨識權限。
          Web 版則需在瀏覽器網站設定允許相機或麥克風。
        </p>
      </section>

      <p>
        <Link href="/">返回看板</Link>
        {" · "}
        <Link href="/privacy">查看隱私說明</Link>
      </p>
    </main>
  );
}
