import { describe, expect, it } from "vitest";
import { prepareSybaseConnection, restoreSybaseForm, setSybaseParameter, sybaseDefaultParameters, sybaseParameter, sybaseUrlPreview } from "@/lib/database/sybaseConnectionForm";

const fields = () => ({ host: "ase.example.com", port: 5000, database: "pos", connection_string: "", url_params: "", external_config: undefined as unknown });

describe("Sybase structured connection form", () => {
  it("generates a complete legacy-compatible URL without requiring a newer JDBC plugin", () => {
    const saved = prepareSybaseConnection(fields());
    expect(saved.connection_string).toBe("jdbc:jtds:sybase://ase.example.com:5000/pos;TDS=5.0;charset=cp936");
    expect(saved.url_params).toBe("");
    expect(saved.host).toBe("ase.example.com");
    expect(saved.database).toBe("pos");
    expect(restoreSybaseForm(saved)).toMatchObject({ connection_string: "", url_params: "TDS=5.0;charset=cp936" });
    expect(prepareSybaseConnection(restoreSybaseForm(saved))).toEqual(saved);
  });

  it("retains custom protocol, charset and literal connection parameters on reopening", () => {
    const config = { ...fields(), host: " custom.local ", port: 5100, database: " other ", url_params: "appName=DBX 中文&TDS;TDS=4.2;CHARSET=GBK" };
    const saved = prepareSybaseConnection(config);
    expect(saved.connection_string).toBe("jdbc:jtds:sybase://custom.local:5100/other;appName=DBX 中文&TDS;TDS=4.2;charset=GBK");
    expect(prepareSybaseConnection(restoreSybaseForm(saved))).toEqual(saved);
  });

  it("allows an empty database and defaults a cleared port", () => {
    expect(prepareSybaseConnection({ ...fields(), database: "", port: 0 }).connection_string).toBe("jdbc:jtds:sybase://ase.example.com:5000/;TDS=5.0;charset=cp936");
  });

  it("supports IPv6 addresses without ambiguous port separators", () => {
    const saved = prepareSybaseConnection({ ...fields(), host: "::1" });
    expect(saved.connection_string).toContain("//[::1]:5000/pos;");
  });

  it("keeps an old full URL as an explicit override and displays its target", () => {
    const connection_string = "jdbc:jtds:sybase://old.local:4100/legacy;TDS=5.0;charset=cp936";
    const restored = restoreSybaseForm({ ...fields(), host: "", port: 0, connection_string });
    expect(restored).toMatchObject({ host: "old.local", port: 4100, database: "legacy", connection_string });
    expect(prepareSybaseConnection(restored).connection_string).toBe(connection_string);
  });

  it("gives a manual URL priority over fields and conflicting parameters", () => {
    const config = { ...fields(), connection_string: "jdbc:jtds:sybase://manual.local:5200/manual;TDS=5.0;charset=utf8;appName=manual", url_params: "TDS=4.2;charset=cp936;appName=fields;loginTimeout=15" };
    const saved = prepareSybaseConnection(config);
    expect(saved).toMatchObject({ host: "manual.local", port: 5200, database: "manual", url_params: "" });
    expect(saved.connection_string).toBe(`${config.connection_string};loginTimeout=15`);
    const restored = restoreSybaseForm(saved);
    expect(restored.connection_string).toBe(config.connection_string);
    expect(restored.url_params).toBe(config.url_params);
    expect(prepareSybaseConnection(restored)).toEqual(saved);
  });

  it("does not inject structured charset and protocol defaults into a manual URL", () => {
    const config = { ...fields(), connection_string: "jdbc:jtds:sybase://manual.local:5000/pos", url_params: sybaseDefaultParameters() };
    expect(prepareSybaseConnection(config).connection_string).toBe(config.connection_string);
  });

  it("updates charset case-insensitively without leaving duplicate options", () => {
    const params = setSybaseParameter("TDS=5.0;CHARSET=gbk;appName=DBX;charset=cp936", "charset", " utf8 ");
    expect(params).toBe("TDS=5.0;appName=DBX;charset=utf8");
    expect(sybaseParameter(params, "CHARSET")).toBe("utf8");
  });

  it.each([{ host: "" }, { host: "host;bad=value" }, { port: -1 }, { port: 65536 }, { port: 1.5 }, { database: "pos;charset=bad" }])("rejects invalid structured targets: %j", (invalid) => {
    expect(() => prepareSybaseConnection({ ...fields(), ...invalid })).toThrow();
  });

  it("previews the effective URL without mutating the form", () => {
    const config = fields();
    expect(sybaseUrlPreview(config)).toBe("jdbc:jtds:sybase://ase.example.com:5000/pos;TDS=5.0;charset=cp936");
    expect(config.connection_string).toBe("");
    expect(config.url_params).toBe("");
  });
});
