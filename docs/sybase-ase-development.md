# Sybase ASE 12.0 connections

For this development checkout, import `.dbx-dev/dbx-jdbc-plugin-sybase-dev.zip`
using **Driver Manager > JDBC > Install from local file** first. This package
contains the local catalog-selection compatibility fix. Then install the
Sybase managed driver, or select `.dbx-dev/jtds-1.3.1.jar` manually.
These local artifacts can be regenerated with `plugins/jdbc/gradlew.bat
-p plugins/jdbc shadowJar` and the layout in `plugins/jdbc/package.sh`.

Select **Sybase ASE (jTDS)** in the SQL category when creating a connection.
Leave **URL (optional)** blank to use host (default `127.0.0.1`), port
(default `5000`) and an optional database (blank by default). Connection parameters default to
`TDS=5.0;charset=cp936`; charset can be changed in connection parameters.
DBX generates the complete URL when saving or testing, including parameters,
so the existing custom JDBC plugin remains compatible. The managed driver and
jTDS driver class are configured internally; the form does not expose driver
JAR, classpath or class overrides.

A manually entered JDBC URL takes priority over the structured target and
charset parameters. Existing full-URL connections remain in this mode; clear
the URL to switch to structured fields. These changes do not alter credentials.

Install **Sybase ASE (jTDS)** in the Driver Manager. This installs the optional
JDBC plugin and resolves `net.sourceforge.jtds:jtds:1.3.1` from Maven Central.
The driver is downloaded separately; it is not embedded in the desktop EXE or
the existing offline JDBC payload.

Use this URL, replacing the host, port and database with your server settings:

```text
jdbc:jtds:sybase://localhost:5000/master;TDS=5.0;charset=cp936
```

Enter the username and password in their separate fields. The driver class is
`net.sourceforge.jtds.jdbc.Driver`. Port 5000 is an editable example, not a
requirement. Preserve the port and other properties of a working DataGrip URL.

For an offline machine, install the JDBC plugin first and select a local jTDS
JAR under JDBC driver paths. An explicitly selected `jtds-*.jar` takes precedence
over the managed version, so the same driver as DataGrip can be reused.
Java 21 is required by the DBX JDBC plugin. jTDS is a pure Java network driver:
a 32-bit ASE server does not require a 32-bit DBX or JVM.

ASE connections retain the generic JDBC dialect and use JDBC metadata for the
object tree. Schema-qualified names distinguish owners such as `dbo`. Table
pagination uses result-set row skipping rather than `LIMIT`, `OFFSET` or
`ROW_NUMBER`, which are unsuitable for ASE 12.0. The JDBC statement is capped at
offset + page size + one probe row, so closing a page does not drain an unbounded
result. This requires the updated local JDBC plugin. Deep pages can be slow; use
filters and a stable sort when browsing large tables.

## Verification

Automated tests cover connection defaults, driver installation routing, manual
JAR precedence, dialect selection and the shared jTDS driver class. They do not
establish a real ASE connection. Before declaring ASE 12.0 compatibility, verify
connection and catalog switching, owners/tables/columns/keys, Chinese text,
query cancellation, and consecutive sorted data pages against the real server.
Advanced DDL editing and procedure scripting require separate verification.

Reference: [jTDS connection properties](https://jtds.sourceforge.net/faq.html).
