// Runtime configuration lives on the Worker env object. A variable specifier
// keeps the Workers-only module out of Node's resolver during local tests.
export type WorkerEnv = {
  DB?: unknown;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  READER_TICKET_SECRET?: string;
  RUST_CONTENT_API_ORIGIN?: string;
};

let cached: Promise<WorkerEnv> | undefined;

export function workerEnv(): Promise<WorkerEnv> {
  if (!cached) {
    const moduleName = "cloudflare:workers";
    cached = import(/* @vite-ignore */ moduleName)
      .then((mod: unknown) => ((mod as { env?: WorkerEnv }).env ?? {}) as WorkerEnv)
      .catch(() => process.env as WorkerEnv);
  }
  return cached;
}
