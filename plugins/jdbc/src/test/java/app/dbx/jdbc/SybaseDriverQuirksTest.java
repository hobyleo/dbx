package app.dbx.jdbc;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;

final class SybaseDriverQuirksTest {
    @Test
    void sybaseStatementLimitIncludesOffsetAndProbeWithoutOverflow() throws Exception {
        var mapper = new ObjectMapper();
        var connection = mapper.createObjectNode()
            .put("connection_string", "jdbc:jtds:sybase://localhost:5000/master");
        var limits = new java.util.ArrayList<Integer>();
        var statement = (java.sql.Statement) java.lang.reflect.Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] { java.sql.Statement.class },
            (proxy, method, args) -> {
                if (method.getName().equals("setMaxRows")) limits.add((Integer) args[0]);
                return null;
            }
        );
        DbxJdbcPlugin.applySybaseRowLimit(connection, statement, "SELECT * FROM dbo.p_inv", 100, 0);
        DbxJdbcPlugin.applySybaseRowLimit(connection, statement, " select\n* FROM dbo.p_inv", 100, 100);
        DbxJdbcPlugin.applySybaseRowLimit(connection, statement, "select * from dbo.p_inv", 100, Integer.MAX_VALUE);
        DbxJdbcPlugin.applySybaseRowLimit(connection, statement, "update dbo.p_inv set value = 1", 100, 0);
        DbxJdbcPlugin.applySybaseRowLimit(connection, statement, "delete from dbo.p_inv", 100, 0);
        DbxJdbcPlugin.applySybaseRowLimit(mapper.createObjectNode().put("connection_string", "jdbc:h2:mem:test"), statement, "select 1", 100, 0);
        assertEquals(java.util.List.of(101, 201, Integer.MAX_VALUE), limits);
    }

    @Test
    void realJtdsParsesLegacySybaseProtocolAndCharsetOnTheCurrentJvm() throws Exception {
        var driver = new net.sourceforge.jtds.jdbc.Driver();
        String url = "jdbc:jtds:sybase://localhost:5000/master;TDS=5.0;charset=cp936";
        assertTrue(driver.acceptsURL(url));
        var properties = new java.util.HashMap<String, String>();
        for (var property : driver.getPropertyInfo(url, new java.util.Properties())) {
            properties.put(property.name.toLowerCase(java.util.Locale.ROOT), property.value);
        }
        assertEquals("5.0", properties.get("tds"));
        assertEquals("cp936", properties.get("charset"));
        assertEquals("master", properties.get("databasename"));
    }

    @Test
    void sharedJtdsDriverDoesNotEnableSqlServerMetadataForSybase() throws Exception {
        var mapper = new ObjectMapper();
        for (String url : new String[] {
            "jdbc:jtds:sybase://localhost:5000/master;TDS=5.0;charset=cp936",
            "JDBC:JTDS:SYBASE://localhost:5000/master",
            "jdbc:sybase:Tds:localhost:5000/master"
        }) {
            var config = mapper.createObjectNode()
                .put("connection_string", url)
                .put("jdbc_driver_class", "net.sourceforge.jtds.jdbc.Driver");
            var quirks = DbxJdbcPlugin.driverQuirks(config);
            assertFalse(quirks.mergeEmptyCatalogSchemas(), url);
            assertFalse(quirks.useOracleMetadata(), url);
            assertEquals(DbxJdbcPlugin.StatementMaxRowsMode.READ_LOOP_ONLY, quirks.statementMaxRowsMode());
        }
        var sqlServer = mapper.createObjectNode()
            .put("connection_string", "jdbc:jtds:sqlserver://localhost:1433/master")
            .put("jdbc_driver_class", "net.sourceforge.jtds.jdbc.Driver");
        assertTrue(DbxJdbcPlugin.driverQuirks(sqlServer).mergeEmptyCatalogSchemas());
    }
}
