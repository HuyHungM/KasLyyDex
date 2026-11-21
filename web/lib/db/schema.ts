import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Application-owned table only. Neon Managed Auth owns its identity/session
// tables in its own schema and they are never managed from this file.
export const profiles = pgTable("profiles", {
  // Opaque Managed Auth user id: never assume a UUID or parse this value.
  userId: text("user_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
