import type { ConnectionConfig } from "@/types/database";

type SybaseConfig = Pick<ConnectionConfig, "host" | "port" | "database" | "connection_string" | "url_params" | "external_config">;

export function sybaseParameter(params: string | undefined, key: string): string {
  const entry = params
    ?.split(";")
    .reverse()
    .find((part) => part.split("=", 1)[0].trim().toLowerCase() === key.toLowerCase());
  return entry?.slice(entry.indexOf("=") + 1).trim() || "";
}

export function setSybaseParameter(params: string | undefined, key: string, value: string): string {
  const entries = (params || "").split(";").filter((part) => part.trim() && part.split("=", 1)[0].trim().toLowerCase() !== key.toLowerCase());
  if (value.trim()) entries.push(`${key}=${value.trim()}`);
  return entries.join(";");
}

export function sybaseDefaultParameters(params?: string): string {
  let result = setSybaseParameter(params, "TDS", sybaseParameter(params, "TDS") || "5.0");
  result = setSybaseParameter(result, "charset", sybaseParameter(params, "charset") || "cp936");
  return result;
}

export function sybaseBaseUrl(config: Pick<SybaseConfig, "host" | "port" | "database">): string {
  let host = config.host.trim();
  if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
  return `jdbc:jtds:sybase://${host}:${config.port || 5000}/${config.database?.trim() || ""}`;
}

function sybaseUrlTarget(url?: string) {
  const match = /^jdbc:jtds:sybase:\/\/(\[[^\]]+\]|[^:/;]+)(?::(\d+))?(?:\/([^;]*))?(?:;|$)/i.exec(url?.trim() || "");
  return match ? { host: match[1], port: Number(match[2] || 5000), database: match[3] || "" } : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Keep the editable form separate from the effective URL sent to older plugins,
 * which do not understand semicolon-delimited Sybase url_params. */
export function restoreSybaseForm<T extends SybaseConfig>(config: T): T {
  const state = record(record(config.external_config).sybase_form);
  if ((state.mode === "fields" || state.mode === "url") && typeof state.parameters === "string") {
    return { ...config, connection_string: state.mode === "url" && typeof state.url === "string" ? state.url : "", url_params: state.parameters };
  }
  // Connections saved before structured fields were introduced retain their URL.
  return {
    ...config,
    ...sybaseUrlTarget(config.connection_string),
    url_params: config.url_params || config.connection_string?.split(";").slice(1).join(";") || "",
  };
}

export function prepareSybaseConnection<T extends SybaseConfig>(config: T): T {
  if (config.connection_string?.trim()) {
    const url = config.connection_string.trim();
    const existingKeys = new Set(
      url
        .split(";")
        .slice(1)
        .map((part) => part.split("=", 1)[0].trim().toLowerCase()),
    );
    // Explicit URL settings win; the structured charset/protocol defaults do not
    // override a manually entered URL. Preserve other separate legacy options.
    const extra = (config.url_params || "")
      .split(";")
      .filter((part) => {
        const key = part.split("=", 1)[0].trim().toLowerCase();
        return key && key !== "charset" && key !== "tds" && !existingKeys.has(key);
      })
      .join(";");
    return {
      ...config,
      ...sybaseUrlTarget(url),
      connection_string: extra ? `${url.replace(/;$/, "")};${extra}` : url,
      url_params: "",
      external_config: { ...record(config.external_config), sybase_form: { mode: "url", url, parameters: config.url_params || "" } },
    };
  }
  const host = config.host.trim();
  const port = Number(config.port || 5000);
  if (!host || /[\s/;=?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid Sybase host or port (1–65535).");
  }
  if (/[;\r\n]/.test(config.database || "")) throw new Error("Invalid Sybase database name.");
  const result = { ...config, host, port, database: config.database?.trim() || undefined, url_params: sybaseDefaultParameters(config.url_params) };
  return {
    ...result,
    connection_string: `${sybaseBaseUrl(result)};${result.url_params}`,
    url_params: "",
    external_config: { ...record(config.external_config), sybase_form: { mode: "fields", parameters: result.url_params } },
  };
}

export function sybaseUrlPreview(config: SybaseConfig): string {
  return `${sybaseBaseUrl({ ...config, host: config.host || "localhost" })};${sybaseDefaultParameters(config.url_params)}`;
}
