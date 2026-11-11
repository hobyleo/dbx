import { describe, expect, it } from "vitest";
import { connectionParameterCatalog, connectionParameterSyntax } from "./connectionParameterCatalog";
import { parseConnectionParameters } from "./connectionParameterDocument";

const names = (db_type: string, driver_profile?: string) => connectionParameterCatalog({ db_type, driver_profile }).map((parameter) => parameter.name);

describe("transport-specific connection parameter catalog", () => {
  it("edits Sybase parameters as literal semicolon properties with an editable charset", () => {
    const context = { db_type: "jdbc", driver_profile: "sybase-ase" };
    const document = parseConnectionParameters("TDS=5.0;charset=cp936;appName=DBX 中文&tools", connectionParameterSyntax(context));
    expect(document.entries.map(({ key, value }) => [key, value])).toEqual([
      ["TDS", "5.0"],
      ["charset", "cp936"],
      ["appName", "DBX 中文&tools"],
    ]);
    expect(connectionParameterCatalog(context).find((parameter) => parameter.name === "charset")?.managedBy).toBeUndefined();
  });
  it("does not advertise the ignored PostgreSQL JDBC stringtype compatibility parameter", () => {
    for (const type of ["postgres", "redshift"]) {
      expect(names(type)).not.toContain("stringtype");
      expect(names(type)).toContain("currentSchema");
    }
  });
  it.each(["doris", "selectdb", "starrocks", "oceanbase", "manticoresearch"])("omits ignored or fixed initialization settings for the %s MySQL profile", (profile) => {
    const supported = names("mysql", profile);
    for (const ignored of ["charset", "dataCharset", "setupMode", "proxysql", "enable_cleartext_plugin"]) expect(supported).not.toContain(ignored);
    expect(supported).toContain("localInfilePath");
    expect(supported).toContain("sessionVariables");
  });
  it("limits TLS and catalog overrides to the compatible profiles that implement them", () => {
    expect(names("mysql", "oceanbase")).not.toContain("ssl-mode");
    expect(names("mysql", "selectdb")).not.toContain("ssl-cert");
    expect(names("mysql", "selectdb")).toContain("catalog");
    for (const profile of ["doris", "starrocks"]) expect(names("mysql", profile)).toContain("ssl-mode");
  });
  it("offers native MySQL initialization settings and scopes dataCharset to native MySQL", () => {
    expect(names("mysql")).toEqual(expect.arrayContaining(["charset", "setupMode", "proxysql", "dataCharset"]));
    expect(names("mysql", " MySQL ")).toContain("dataCharset");
    for (const profile of ["mariadb", "tidb", "dolt"]) expect(names("mysql", profile)).not.toContain("dataCharset");
  });
  it("offers Oracle byte compatibility only in Thin mode without a duplicate form setting", () => {
    expect(names("oracle")).toEqual(["DBX_LEGACY_CHARSET"]);
    expect(connectionParameterCatalog({ db_type: "oracle" })[0].managedBy).toBeUndefined();
    expect(names("oracle", "oci")).toEqual([]);
  });
});
