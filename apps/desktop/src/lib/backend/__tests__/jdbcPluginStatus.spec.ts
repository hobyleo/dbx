import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe.each(["http", "tauri"] as const)("JDBC plugin status %s transport", (transport) => {
  const status = { installed: true, compatible: true };
  const fetchMock = vi.fn();
  let backend: typeof import("@/lib/backend/http");

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(status);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => status });
    vi.stubGlobal("fetch", fetchMock);
    backend = await import(transport === "http" ? "@/lib/backend/http" : "@/lib/backend/tauri");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests local status for connection readiness", async () => {
    await expect(backend.jdbcPluginStatus(false)).resolves.toEqual(status);
    if (transport === "tauri") {
      expect(mocks.invoke).toHaveBeenCalledWith("jdbc_plugin_status", { checkUpdates: false });
    } else {
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/jdbc/plugin/status?check_updates=false");
    }
  });

  it("keeps update checks enabled for existing callers", async () => {
    await backend.jdbcPluginStatus();
    if (transport === "tauri") {
      expect(mocks.invoke).toHaveBeenCalledWith("jdbc_plugin_status", { checkUpdates: true });
    } else {
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/jdbc\/plugin\/status$/);
    }
  });
});
