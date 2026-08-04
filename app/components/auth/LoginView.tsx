"use client";

import { useState, type FormEvent } from "react";
import { loginWithPassword } from "../../auth/api";
import type { AppConfig } from "../../app-config";
import type { SyncConfig } from "../../sync/config";

export function LoginView({
  appConfig,
  message,
  onAuthenticated,
  onUseLocal,
}: {
  appConfig: AppConfig;
  message?: string;
  onAuthenticated: (config: SyncConfig) => Promise<void>;
  onUseLocal: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [personalToken, setPersonalToken] = useState("");
  const [method, setMethod] = useState<"password" | "token">("password");
  const [baseUrl, setBaseUrl] = useState(appConfig.syncServerUrl);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (method === "token") {
        const token = personalToken.trim();
        if (token.length < 32 || /\s/.test(token)) {
          setError("個人 Token 格式不正確。");
          return;
        }
        await onAuthenticated({ baseUrl, token });
      } else {
        const result = await loginWithPassword({ baseUrl, email, password });
        await onAuthenticated(result.config);
      }
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : "";
      if (code === "invalid_credentials" || code === "unauthorized") {
        setError("電子郵件或密碼不正確。");
      } else if (code === "login_rate_limited") {
        setError("登入嘗試次數過多，請在 15 分鐘後再試。");
      } else {
        setError(cause instanceof Error ? cause.message : "目前無法登入，請稍後再試。");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loginShell">
      <section className="loginBrand" aria-labelledby="loginTitle">
        <div>
          <p className="eyebrow">Kanban workspace</p>
          <h1 id="loginTitle">{appConfig.title}</h1>
          <p>登入後，只會看到你參與的專案與被指派的工作。</p>
        </div>
        <ul className="loginBenefits" aria-label="服務特色">
          <li><strong>多專案</strong><span>每個專案有自己的看板與成員</span></li>
          <li><strong>角色分工</strong><span>平台管理、Project Owner 與 Member</span></li>
          <li><strong>跨裝置</strong><span>網頁與 Mobile 使用相同帳號</span></li>
        </ul>
      </section>

      <section className="loginCard" aria-label="登入">
        <div className="loginCardHeading">
          <p className="eyebrow">Welcome back</p>
          <h2>{method === "password" ? "登入工作區" : "使用個人 Token"}</h2>
          <p>{method === "password" ? "使用管理者為你建立的帳號。" : "供既有帳號移轉與管理者救援使用。"}</p>
        </div>
        {message && <p className="notice warning" role="status">{message}</p>}
        <form onSubmit={submit}>
          {method === "password" ? (
            <>
              <label className="formField">
                <span>電子郵件</span>
                <input
                  autoFocus
                  type="email"
                  autoComplete="username"
                  value={email}
                  required
                  placeholder="name@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="formField">
                <span>密碼</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  value={password}
                  required
                  placeholder="至少 12 個字元"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="formField">
              <span>個人 Token</span>
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={personalToken}
                required
                placeholder="貼上既有的個人 Token"
                onChange={(event) => setPersonalToken(event.target.value)}
              />
            </label>
          )}
          <button className="serverDisclosure" type="button" onClick={() => setShowServer((value) => !value)}>
            {showServer ? "隱藏" : "顯示"}伺服器設定
          </button>
          {showServer && (
            <label className="formField serverField">
              <span>同步伺服器</span>
              <input
                type="url"
                inputMode="url"
                value={baseUrl}
                required
                placeholder="https://kanban-sync.example.workers.dev"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
          )}
          {error && <p className="notice warning" role="alert">{error}</p>}
          <button className="primaryButton loginSubmit" type="submit" disabled={busy || !baseUrl}>
            {busy ? "登入中…" : method === "password" ? "登入" : "驗證並登入"}
          </button>
        </form>
        <button className="tokenMethodButton" type="button" onClick={() => {
          setMethod((value) => value === "password" ? "token" : "password");
          setError("");
        }}>
          {method === "password" ? "既有管理者？改用個人 Token" : "返回電子郵件與密碼登入"}
        </button>
        <div className="loginDivider"><span>或</span></div>
        <button className="localModeButton" type="button" onClick={onUseLocal}>
          使用此裝置的本機看板
        </button>
        <p className="loginFootnote">本機模式不會連線到團隊專案，也不需要帳號。</p>
      </section>
    </main>
  );
}
