import type { Metadata } from "next";
import Link from "next/link";
import { SupportContent } from "../components/legal/SupportContent";

export const metadata: Metadata = {
  title: "支援｜定恆人工智能",
  description: "定恆人工智能的同步、離線與權限問題排解方式。",
};

export default function SupportPage() {
  return (
    <main className="legalPage">
      <p className="eyebrow">定恆人工智能</p>
      <h1>支援</h1>
      <SupportContent />

      <p>
        <Link href="/">返回看板</Link>
        {" · "}
        <Link href="/privacy">查看隱私說明</Link>
      </p>
    </main>
  );
}
