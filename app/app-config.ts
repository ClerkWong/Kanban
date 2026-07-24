import rawAppConfig from "../public/app-config.json";

export interface AppConfig {
  title: string;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  title: "覓夜",
};

export function parseAppConfig(value: unknown): AppConfig {
  if (!value || typeof value !== "object") {
    return DEFAULT_APP_CONFIG;
  }

  const title = Reflect.get(value, "title");
  if (typeof title !== "string") {
    return DEFAULT_APP_CONFIG;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > 80) {
    return DEFAULT_APP_CONFIG;
  }

  return { title: normalizedTitle };
}

export const bundledAppConfig = parseAppConfig(rawAppConfig);

export async function loadAppConfig(
  url = "/app-config.json",
  fetcher: typeof fetch = fetch,
): Promise<AppConfig> {
  try {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) {
      return bundledAppConfig;
    }
    return parseAppConfig(await response.json());
  } catch {
    return bundledAppConfig;
  }
}
