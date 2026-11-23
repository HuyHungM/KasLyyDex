import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "../netlify/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.NETLIFY_DB_URL ?? "",
  },
});
