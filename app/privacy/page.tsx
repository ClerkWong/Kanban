import type { Metadata } from "next";
import Link from "next/link";
import { PrivacyContent } from "../components/legal/PrivacyContent";

export const metadata: Metadata = {
  title: "隱私說明｜本機 Kanban",
  description: "本機 Kanban 的裝置儲存、雲端同步與權限使用說明。",
};

export default function PrivacyPage() {
  return (
    <main className="legalPage">
      <p className="eyebrow">本機 Kanban</p>
      <h1>隱私說明</h1>
      <PrivacyContent />

      <p>
        <Link href="/">返回看板</Link>
        {" · "}
        <Link href="/support">取得支援</Link>
      </p>
    </main>
  );
}
