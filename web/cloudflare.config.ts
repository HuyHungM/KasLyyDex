import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersCacheConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersCacheConfig();

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: "kaslyydex",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-24",
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
      DB: bindings.d1({ name: "kaslyydex", id: "b4f42144-16fb-471b-bdec-c4823337c939" }),
      SESSION_SECRET: bindings.secret(),
    },
  }),
});
