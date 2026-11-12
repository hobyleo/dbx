import { describe, expect, it, vi } from "vitest";
import { effectiveDatabaseTypeForConnection, jdbcConnectionUsesDriverRowOffset, jdbcDriverProfileUsesSchemaQualification } from "@/lib/database/jdbcDialect";
import { jdbcProductConnectionDefaults, ensureJdbcProductRuntimeDrivers } from "@/lib/database/jdbcProductProfile";
import { jdbcProductPickerOptions, jdbcProductProfileForConfig } from "@/lib/database/jdbcProductProfiles";
import { installRegisteredManagedJdbcDriver } from "@/lib/database/managedJdbcDrivers";
import { SYBASE_ASE_JDBC_URL, SYBASE_JDBC_PRODUCT_PROFILE, SYBASE_JTDS_COORDINATE, SYBASE_JTDS_DRIVER_CLASS } from "@/lib/database/sybaseConnection";
import type { ConnectionConfig } from "@/types/database";

describe("Sybase ASE 12 jTDS connections", () => {
  it("offers a SQL product profile with legacy protocol and Chinese charset defaults", () => {
    expect(jdbcProductPickerOptions()).toContainEqual({ value: "sybase-ase", label: "Sybase ASE (jTDS)" });
    expect(jdbcProductProfileForConfig({ db_type: "jdbc", driver_profile: "sybase-ase" })).toBe(SYBASE_JDBC_PRODUCT_PROFILE);
    expect(jdbcProductConnectionDefaults(SYBASE_JDBC_PRODUCT_PROFILE, "jtds")).toEqual({ connectionString: SYBASE_ASE_JDBC_URL, driverClass: SYBASE_JTDS_DRIVER_CLASS });
    expect(SYBASE_ASE_JDBC_URL).toContain(";TDS=5.0;charset=cp936");
  });

  it("keeps Sybase on generic JDBC even when metadata mentions SQL Server", () => {
    const connection = {
      db_type: "jdbc" as const,
      driver_profile: "sybase-ase",
      connection_string: SYBASE_ASE_JDBC_URL,
      jdbc_driver_class: SYBASE_JTDS_DRIVER_CLASS,
      database_info: { driverName: "jTDS SQL Server and Sybase" },
    };
    const dialect = effectiveDatabaseTypeForConnection(connection);
    expect(dialect).toBe("jdbc");
    expect(jdbcConnectionUsesDriverRowOffset(connection, dialect)).toBe(true);
    expect(jdbcDriverProfileUsesSchemaQualification("sybase-ase")).toBe(true);
    expect(effectiveDatabaseTypeForConnection({ db_type: "jdbc", connection_string: "jdbc:jtds:sqlserver://localhost:1433/master" })).toBe("sqlserver");
  });

  it("preserves the user's DataGrip URL, charset and manually selected jTDS JAR", async () => {
    const config = {
      db_type: "jdbc",
      driver_profile: "sybase-ase",
      connection_string: "jdbc:jtds:sybase://db.example.com:4100/app;TDS=5.0;charset=cp936",
      jdbc_driver_paths: ["C:\\drivers\\jtds-1.2.8.jar"],
    } as ConnectionConfig;
    const originalUrl = config.connection_string;
    const jdbcPluginStatus = vi.fn(async () => ({ installed: true, compatible: true }));
    const result = await ensureJdbcProductRuntimeDrivers(SYBASE_JDBC_PRODUCT_PROFILE, config, {
      jdbcPluginStatus,
      listJdbcMavenBundles: async () => [],
    });
    expect(result?.paths).toEqual(["C:\\drivers\\jtds-1.2.8.jar"]);
    expect(jdbcPluginStatus).toHaveBeenCalledWith(false);
    expect(config.connection_string).toBe(originalUrl);
    expect(config.jdbc_driver_class).toBe(SYBASE_JTDS_DRIVER_CLASS);
  });

  it("installs jTDS through the existing driver manager", async () => {
    const installJdbcDriverFromMaven = vi.fn(async () => []);
    await installRegisteredManagedJdbcDriver(
      "sybase-ase",
      [],
      { installed: true, compatible: true },
      {
        installJdbcPlugin: vi.fn(),
        installJdbcDriverFromMaven,
        listJdbcMavenBundles: async () => [],
        deleteJdbcMavenBundle: vi.fn(),
      },
    );
    expect(installJdbcDriverFromMaven).toHaveBeenCalledWith(SYBASE_JTDS_COORDINATE, ["https://repo.maven.apache.org/maven2/"]);
  });
});
