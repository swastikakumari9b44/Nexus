// Builds the production bundle twice and serves it:
//   :4173  same-origin build  (/api is proxied to the backend by `preview.proxy`)
//   :4174  "direct" build     (VITE_API_BASE from .env.direct => browser calls the backend cross-origin, exercising CORS)
import { build, preview } from "vite";

await build({ logLevel: "warn" });
await build({ mode: "direct", logLevel: "warn", build: { outDir: "dist-direct", emptyOutDir: true } });
await preview({ preview: { port: 4173, strictPort: true, host: "127.0.0.1" } });
await preview({ mode: "direct", build: { outDir: "dist-direct" },
                preview: { port: 4174, strictPort: true, host: "127.0.0.1", proxy: {} } });
console.log("e2e frontend ready: http://127.0.0.1:4173 and http://127.0.0.1:4174");
setInterval(() => {}, 1 << 30);
