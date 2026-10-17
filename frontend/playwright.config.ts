import { defineConfig } from "@playwright/test";

// Windows PowerShell:  $env:NEXUS_PYTHON = "..\backend\.venv\Scripts\python.exe"
const py = process.env.NEXUS_PYTHON ?? "python";
// Optional: use an existing Chromium instead of `playwright install chromium` (restricted networks).
const exe = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,                 // tests share one backend + booking DB (slots are a shared resource)
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e-results/results.json" }]],
  outputDir: "e2e-results/artifacts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    launchOptions: exe ? { executablePath: exe, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] } : {},
  },
  webServer: [
    {
      command: `"${py}" -m scripts.e2e_server --port 8000`,   // quoted: the interpreter path may contain spaces on Windows
      cwd: "../backend",
      url: "http://127.0.0.1:8000/api/health",
      timeout: 180_000,
      reuseExistingServer: false,
      env: { E2E_SSE_DELAY_MS: "400", PYTHONUTF8: "1" },
    },
    {
      command: "node e2e/serve.mjs",
      url: "http://127.0.0.1:4173",
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
