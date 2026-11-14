import { createCache } from "./app.js";

const app = createCache();
await app.start();
console.info(`cache: listening on ${app.config.host}:${app.config.port}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void app.stop().finally(() => process.exit(0)));
}
