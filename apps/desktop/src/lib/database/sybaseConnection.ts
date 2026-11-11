import type { JdbcProductProfileDefinition } from "@/lib/database/jdbcProductProfile";
import type { ManagedJdbcDriverDefinition } from "@/lib/database/managedJdbcDriver";

export const SYBASE_DRIVER_PROFILE = "sybase-ase";
export const SYBASE_JTDS_COORDINATE = "net.sourceforge.jtds:jtds:1.3.1";
export const SYBASE_JTDS_DRIVER_CLASS = "net.sourceforge.jtds.jdbc.Driver";
export const SYBASE_ASE_JDBC_URL = "jdbc:jtds:sybase://localhost:5000/master;TDS=5.0;charset=cp936";

export const SYBASE_MANAGED_JDBC_DRIVER: ManagedJdbcDriverDefinition = {
  id: SYBASE_DRIVER_PROFILE,
  label: "Sybase ASE (jTDS)",
  version: "1.3.1",
  jre: "21",
  bundles: [{ coordinate: SYBASE_JTDS_COORDINATE, repositories: ["https://repo.maven.apache.org/maven2/"] }],
};

export const SYBASE_JDBC_PRODUCT_PROFILE: JdbcProductProfileDefinition = {
  id: SYBASE_DRIVER_PROFILE,
  label: "Sybase ASE (jTDS)",
  icon: SYBASE_DRIVER_PROFILE,
  category: "sql",
  port: 5000,
  user: "sa",
  match: { dbType: "jdbc", driverProfile: SYBASE_DRIVER_PROFILE },
  managedDriverId: SYBASE_DRIVER_PROFILE,
  runtimeLabelKey: "connection.sybaseRuntimeOption",
  driverManagerHintPrefixKey: "connection.sybaseDriverManagerHintPrefix",
  driverManagerHintSuffixKey: "connection.sybaseDriverManagerHintSuffix",
  docsLabelKey: "connection.sybaseDocs",
  docsUrl: "https://jtds.sourceforge.net/faq.html",
  missingDriverError: "Sybase ASE jTDS driver is not installed. Install it from the Driver Manager, then retry.",
  missingPluginError: "DBX JDBC plugin is not installed. Install Sybase ASE (jTDS) from the Driver Manager, then retry.",
  modes: [
    {
      id: "jtds",
      labelKey: "connection.sybaseJtdsMode",
      hintKey: "connection.sybaseJtdsModeHint",
      defaultConnectionString: SYBASE_ASE_JDBC_URL,
      defaultDriverClass: SYBASE_JTDS_DRIVER_CLASS,
      managedCoordinates: [SYBASE_JTDS_COORDINATE],
    },
  ],
  detectMode: () => "jtds",
  isCompatibleRuntimePath: (path) => /^jtds(?:-[\w.-]+)?\.jar$/i.test(path.split(/[/\\]/).pop() ?? ""),
};
