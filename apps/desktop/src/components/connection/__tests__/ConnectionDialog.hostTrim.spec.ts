// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ConnectionConfig } from "@/types/database";
import { prepareSybaseConnection } from "@/lib/database/sybaseConnectionForm";

const { store, settings, backend } = vi.hoisted(() => ({
  store: {
    connectionGroupOptions: [],
    newConnectionGroupId: null,
    selectedConnectionGroupId: null,
    addConnection: vi.fn(),
    updateConnection: vi.fn(),
    connect: vi.fn(),
    ensureConnected: vi.fn(),
    addEphemeralConnection: vi.fn(),
    removeConnection: vi.fn(),
    startEditing: vi.fn(),
    stopEditing: vi.fn(),
    clearConnectionError: vi.fn(),
    updateConnectionDatabaseInfo: vi.fn(),
    applyGlobalTimeouts: vi.fn((config) => config),
    getConfig: vi.fn(),
  },
  settings: {
    editorSettings: { sidebarShowConnectionNotes: false, globalConnectTimeoutSecs: 10, globalQueryTimeoutSecs: 0 },
    rememberedDatabaseForConnection: vi.fn(() => ""),
    persistEditorSettings: vi.fn(),
    updateEditorSettings: vi.fn(),
    updateEditorSettingsAndPersist: vi.fn(),
  },
  backend: {
    connectDb: vi.fn(),
    disconnectDb: vi.fn(),
    testConnectionWithInfo: vi.fn(),
    ensureBundledJdbcRuntime: vi.fn().mockResolvedValue(undefined),
    listDatabases: vi.fn(),
    listPlugins: vi.fn(),
    listJdbcDrivers: vi.fn(),
    listJdbcMavenBundles: vi.fn(),
    listJdbcLocalBundles: vi.fn(),
    listSshConfigHosts: vi.fn(),
    listInstalledAgentsLocal: vi.fn(),
    listenAgentInstallProgress: vi.fn(),
  },
}));

vi.mock("@/stores/connectionStore", () => ({ useConnectionStore: () => store, CONNECTION_ATTEMPT_CANCELLED_MESSAGE: "cancelled" }));
vi.mock("@/stores/settingsStore", async (original) => ({ ...(await original<typeof import("@/stores/settingsStore")>()), useSettingsStore: () => settings }));
vi.mock("@/stores/tunnelProfileStore", () => ({ useTunnelProfileStore: () => ({ profiles: [], profileById: () => undefined, init: vi.fn() }) }));
vi.mock("@/lib/backend/api", async (original) => ({ ...(await original<typeof import("@/lib/backend/api")>()), ...backend }));
vi.mock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
vi.mock("@/composables/useToast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  const Dialog = defineComponent({
    props: { open: Boolean },
    emits: ["update:open"],
    setup:
      (props, { slots, emit }) =>
      () =>
        props.open ? h("section", [h("button", { "data-testid": "dismiss-dialog", onClick: () => emit("update:open", false) }, "Dismiss"), slots.default?.()]) : null,
  });
  return { Dialog, DialogContent: passthrough, DialogHeader: passthrough, DialogTitle: passthrough, DialogFooter: passthrough };
});
vi.mock("@/components/ui/button", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Button: defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { attrs, slots }) =>
        () =>
          h("button", attrs, slots.default?.()),
    }),
  };
});
vi.mock("@/components/ui/tabs", async () => {
  const { defineComponent, h } = await import("vue");
  const pass = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h("div", slots.default?.()),
  });
  const TabsContent = defineComponent({
    props: { value: String },
    setup:
      (props, { slots }) =>
      () =>
        props.value === "connection" ? h("div", slots.default?.()) : null,
  });
  return { Tabs: pass, TabsContent, TabsList: pass, TabsTrigger: pass };
});
vi.mock("@/components/ui/tooltip", async () => {
  const { defineComponent, h } = await import("vue");
  const pass = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h("span", slots.default?.()),
  });
  return { HelpTooltip: pass, Tooltip: pass, TooltipContent: pass, TooltipTrigger: pass };
});

import ConnectionDialog from "@/components/connection/ConnectionDialog.vue";

const mountedApps: App[] = [];

async function settle() {
  for (let i = 0; i < 8; i++) await nextTick();
}

async function mountDialog(config: ConnectionConfig) {
  const props = reactive({ open: true, editConfig: config });
  store.getConfig.mockReturnValue(config);
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(ConnectionDialog, {
          ...props,
          "onUpdate:open": (value: boolean) => {
            props.open = value;
          },
        }),
    }),
  );
  app.use(i18n);
  mountedApps.push(app);
  app.mount(container);
  await settle();
}

function inputByValue(value: string): HTMLInputElement | null {
  return [...document.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === value) ?? null;
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

function saveButton(): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save") ?? null;
}

async function saveDialog() {
  saveButton()?.click();
  for (let i = 0; i < 12; i++) await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  i18n.global.locale.value = "en";
  for (const fn of Object.values(backend)) fn.mockResolvedValue([]);
  backend.listenAgentInstallProgress.mockResolvedValue(() => {});
  store.updateConnection.mockResolvedValue(undefined);
  store.addConnection.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.innerHTML = "";
});

function postgresConnection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "pg-1",
    name: "PostgreSQL",
    db_type: "postgresql",
    host: "original.local",
    port: 5432,
    username: "dbx",
    password: "secret-pass",
    ...overrides,
  } as ConnectionConfig;
}

describe("ConnectionDialog whitespace trimming", () => {
  it("trims stray whitespace around host and username before saving", async () => {
    await mountDialog(postgresConnection());

    const hostInput = inputByValue("original.local");
    expect(hostInput, "host input should be rendered").toBeTruthy();
    setInputValue(hostInput!, "  docker.for.mac.host.internal  ");
    await settle();

    await saveDialog();

    expect(store.updateConnection).toHaveBeenCalledWith(expect.objectContaining({ host: "docker.for.mac.host.internal" }));
  });

  it("keeps the password untouched so surrounding spaces stay significant", async () => {
    await mountDialog(postgresConnection({ password: " padded secret " }));

    await saveDialog();

    expect(store.updateConnection).toHaveBeenCalledWith(expect.objectContaining({ password: " padded secret " }));
  });

  it("does not trim the host for file-path based connections", async () => {
    await mountDialog({
      id: "sqlite-1",
      name: "SQLite",
      db_type: "sqlite",
      host: "/tmp/original.db",
      port: 0,
      username: "",
      password: "",
    } as ConnectionConfig);

    const pathInput = inputByValue("/tmp/original.db");
    expect(pathInput, "file path input should be rendered").toBeTruthy();
    setInputValue(pathInput!, "/tmp/ spaced name.db ");
    await settle();

    await saveDialog();

    expect(store.updateConnection).toHaveBeenCalledWith(expect.objectContaining({ host: "/tmp/ spaced name.db " }));
  });
});

describe("ConnectionDialog Sybase structured fields", () => {
  const sybaseConnection = () => ({
    ...postgresConnection(),
    id: "sybase-1",
    name: "Sybase",
    db_type: "jdbc" as const,
    driver_profile: "sybase-ase",
    host: "ase.local",
    port: 5000,
    database: "pos",
    username: "sa",
    password: "",
    connection_string: "",
    url_params: "",
  });

  it("reopens structured fields, hides driver and charset controls, and saves edited fields", async () => {
    await mountDialog(prepareSybaseConnection(sybaseConnection()));
    const url = document.querySelector<HTMLInputElement>("#sybase-jdbc-url")!;
    const host = document.querySelector<HTMLInputElement>("#sybase-host")!;
    const port = document.querySelector<HTMLInputElement>("#sybase-port")!;
    const database = document.querySelector<HTMLInputElement>("#sybase-database")!;
    expect(document.querySelector("#sybase-charset")).toBeNull();
    expect(url.value).toBe("");
    expect(host.disabled).toBe(false);
    expect(port.value).toBe("5000");
    expect(document.querySelector("textarea[placeholder*='JAR']")).toBeNull();
    expect(document.querySelector("label[for='sybase-jdbc-url']")?.textContent).toBe("URL (optional)");
    expect(port.getAttribute("aria-label")).toBe("Port");
    expect([...document.querySelectorAll("button")].some((button) => /Driver Manager|jTDS.*[Dd]ocs/.test(button.textContent || ""))).toBe(false);
    setInputValue(host, "new.local");
    setInputValue(port, "5100");
    setInputValue(database, "testdb");
    await settle();
    await saveDialog();
    expect(store.updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "new.local",
        port: 5100,
        database: "testdb",
        password: "",
        connection_string: "jdbc:jtds:sybase://new.local:5100/testdb;TDS=5.0;charset=cp936",
        url_params: "",
      }),
    );
  });

  it("preserves legacy full URLs", async () => {
    const connection_string = "jdbc:jtds:sybase://old.local:4100/legacy;TDS=5.0;charset=cp936";
    await mountDialog({ ...sybaseConnection(), host: "", port: 0, connection_string });
    const host = document.querySelector<HTMLInputElement>("#sybase-host")!;
    expect(host.value).toBe("old.local");
    expect(host.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#sybase-database")?.disabled).toBe(true);
    await saveDialog();
    expect(store.updateConnection).toHaveBeenCalledWith(expect.objectContaining({ connection_string }));
  });

  it("switches a legacy URL to structured fields when cleared, retaining its charset and options", async () => {
    await mountDialog({ ...sybaseConnection(), host: "", port: 0, connection_string: "jdbc:jtds:sybase://old.local:4100/legacy;TDS=5.0;charset=gbk;appName=DBX" });
    setInputValue(document.querySelector<HTMLInputElement>("#sybase-jdbc-url")!, "");
    await settle();
    expect(document.querySelector<HTMLInputElement>("#sybase-host")?.disabled).toBe(false);
    expect(document.querySelector("#sybase-charset")).toBeNull();
    await saveDialog();
    expect(store.updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "old.local",
        port: 4100,
        database: "legacy",
        connection_string: "jdbc:jtds:sybase://old.local:4100/legacy;appName=DBX;TDS=5.0;charset=gbk",
      }),
    );
  });

  it("switches to an explicit URL without overwriting its charset with form defaults", async () => {
    await mountDialog(prepareSybaseConnection(sybaseConnection()));
    const url = "jdbc:jtds:sybase://manual.local:5200/other;charset=gbk;TDS=5.0";
    setInputValue(document.querySelector<HTMLInputElement>("#sybase-jdbc-url")!, url);
    await settle();
    expect(document.querySelector<HTMLInputElement>("#sybase-host")?.disabled).toBe(true);
    expect(document.querySelector("#sybase-charset")).toBeNull();
    await saveDialog();
    expect(store.updateConnection).toHaveBeenCalledWith(expect.objectContaining({ connection_string: url, host: "manual.local", port: 5200, database: "other" }));
  });
});
