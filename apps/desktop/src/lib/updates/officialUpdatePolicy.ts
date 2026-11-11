// Preserve this fork and its Sybase JDBC fixes until custom release feeds exist.
// Other driver packages, MCP and marketplace plugins keep their own updates.
export const OFFICIAL_UPDATE_POLICY = {
  app: false,
  jdbc: false,
} as const;
