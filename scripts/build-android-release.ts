/**
 * 建置已簽章的 Android release AAB。
 *
 * 簽章密碼只從不回顯的互動提示或 stdin 讀取，不接受命令列參數——參數會留在 shell
 * history，也會出現在 ps 的參數列裡。
 */
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const ANDROID_DIR = path.join(REPO_ROOT, "android");
const AAB_PATH = path.join(
  ANDROID_DIR,
  "app/build/outputs/bundle/release/app-release.aab",
);
/** Android Studio 內建的 JDK 25 會讓 Gradle 報 Unsupported class file major version 69。 */
const DEFAULT_JAVA_HOME = "/opt/homebrew/opt/openjdk@21";
const DEFAULT_KEYSTORE = path.join(homedir(), "keys/wongkanban-upload.jks");

function fail(message: string): never {
  process.stderr.write(`✗ ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { keystore: string } {
  let keystore = process.env.KANBAN_ANDROID_KEYSTORE_PATH ?? DEFAULT_KEYSTORE;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keystore") {
      const value = argv[index + 1];
      if (!value) fail("--keystore 後面要接 keystore 路徑。");
      keystore = value;
      index += 1;
    } else if (arg.startsWith("--keystore=")) {
      keystore = arg.slice("--keystore=".length);
    } else if (arg.includes("password") || arg.includes("--pass")) {
      fail("密碼不可使用命令列參數傳入；本腳本會從隱藏提示或 stdin 讀取。");
    } else {
      fail(`未知參數：${arg}`);
    }
  }
  return { keystore };
}

/** 與 scripts/manage-sync-token.ts 相同的隱藏輸入做法。 */
async function readInteractiveSecret(label: string): Promise<string> {
  process.stderr.write(`${label}（輸入內容不會顯示）：`);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error("已取消建置。"));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) value = value.slice(0, -1);
        else if (byte >= 32 && byte <= 126 && value.length < 4096) {
          value += String.fromCharCode(byte);
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readPipedSecret(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

type RunResult = { code: number; stdout: string };

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string; inherit?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: options.inherit
        ? ["ignore", "inherit", "inherit"]
        : [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", () => {});
    if (options.stdin !== undefined) {
      child.stdin?.end(`${options.stdin}\n`);
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function main(): Promise<void> {
  const { keystore } = parseArgs(process.argv.slice(2));
  const javaHome = process.env.JAVA_HOME ?? DEFAULT_JAVA_HOME;
  const keytool = path.join(javaHome, "bin/keytool");

  if (!existsSync(keystore)) fail(`找不到 keystore：${keystore}`);
  try {
    accessSync(keytool, constants.X_OK);
  } catch {
    fail(
      `找不到可執行的 keytool：${keytool}\n` +
      "  請安裝 JDK 21（brew install openjdk@21）或以 JAVA_HOME 指向它。\n" +
      "  Android Studio 內建的 JDK 25 會讓 Gradle 報 Unsupported class file major version 69。",
    );
  }

  // Gradle daemon 會快取環境，先停掉避免沿用舊狀態。
  await run("./gradlew", ["--stop"], { cwd: ANDROID_DIR, env: { ...process.env, JAVA_HOME: javaHome } });

  const password = process.stdin.isTTY
    ? await readInteractiveSecret("Keystore 密碼")
    : await readPipedSecret();
  if (!password) fail("密碼是空的。");

  // alias 由 keytool 讀出，不靠猜。密碼走 stdin，避免 -storepass 讓密碼進 ps 參數列。
  // -J-Duser.language=en 強制英文輸出，否則中文語系下 PrivateKeyEntry 會被翻譯而抓不到。
  const listed = await run(
    keytool,
    ["-J-Duser.language=en", "-list", "-keystore", keystore],
    { stdin: password },
  );
  const alias = listed.stdout
    .split("\n")
    .find((line) => line.includes("PrivateKeyEntry"))
    ?.split(",")[0]
    ?.trim();
  if (!alias) {
    fail("密碼錯誤，或這個 keystore 沒有 PrivateKeyEntry。");
  }
  process.stderr.write(`✓ alias = ${alias}\n`);

  // 必須用 ORG_GRADLE_PROJECT_*，不能用 KANBAN_ANDROID_*：--no-daemon 仍會為了套用 JVM
  // 設定 fork 一個 single-use daemon，build script 內的 System.getenv 讀不到我們設的環境
  // 變數。ORG_GRADLE_PROJECT_<name> 由 Gradle client 轉成 project property 傳給 daemon。
  const build = await run("./gradlew", ["--no-daemon", ":app:bundleRelease"], {
    cwd: ANDROID_DIR,
    inherit: true,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      ORG_GRADLE_PROJECT_kanbanKeystorePath: keystore,
      ORG_GRADLE_PROJECT_kanbanKeystorePassword: password,
      ORG_GRADLE_PROJECT_kanbanKeyAlias: alias,
      ORG_GRADLE_PROJECT_kanbanKeyPassword: password,
    },
  });
  if (build.code !== 0) fail(`Gradle 建置失敗（exit ${build.code}），請看上面的輸出。`);
  if (!existsSync(AAB_PATH)) fail(`建置結束但找不到 AAB：${AAB_PATH}`);

  const printed = await run(
    keytool,
    ["-J-Duser.language=en", "-printcert", "-jarfile", AAB_PATH],
  );
  const owner = printed.stdout.split("\n").find((line) => line.startsWith("Owner:"))?.trim();

  process.stderr.write(`\n✓ AAB：${AAB_PATH}\n`);
  process.stderr.write(`  大小：${(statSync(AAB_PATH).size / 1024 / 1024).toFixed(1)} MB\n`);
  process.stderr.write(`  簽章者：${owner ?? "（讀不到憑證，請自行以 keytool -printcert -jarfile 檢查）"}\n`);
  process.stderr.write("  上傳到 Play Console 的內部測試軌道前，請先核對 versionCode。\n");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
