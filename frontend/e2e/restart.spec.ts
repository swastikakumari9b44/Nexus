import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bookingPanel, expect, send, slotButtons, test } from "./fixtures";

const PY = process.env.NEXUS_PYTHON ?? "python";
const PORT = 8002;
const API = `http://127.0.0.1:${PORT}`;

function startBackend(dataDir: string): ChildProcess {
  return spawn(PY, ["-m", "scripts.e2e_server", "--port", String(PORT), "--data-dir", dataDir,
                    "--origins", "http://127.0.0.1:4173"], {
    cwd: fileURLToPath(new URL("../../backend", import.meta.url)), stdio: "ignore",
    env: { ...process.env, PYTHONUTF8: "1", E2E_SSE_DELAY_MS: "0" },
  });
}
async function healthy(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if ((await fetch(`${API}/api/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("backend did not become healthy");
}
async function kill(p: ChildProcess) {
  const exited = new Promise((r) => p.once("exit", r));
  p.kill("SIGKILL");                                    // hard crash: no graceful shutdown
  await exited;
}

test("backend is SIGKILLed and restarted mid-booking: the browser resumes and the booking completes", async ({ page, request, diag }) => {
  test.setTimeout(240_000);
  diag.allowFailed(/.*/); diag.allowStatus(/.*/);       // the backend is deliberately down for part of this test
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-restart-"));
  let proc = startBackend(dataDir);
  try {
    await healthy();
    // route this page's /api traffic to the second backend instance (port 8002)
    await page.route("**/api/**", (route) =>
      route.continue({ url: route.request().url().replace("http://127.0.0.1:4173", API) }));
    await page.goto("/");
    await page.evaluate((id) => localStorage.setItem("nexus.thread_id", id), crypto.randomUUID());
    await page.reload();
    await send(page, "book a performance review");
    await send(page, "My name is Kim Ro and my email is kim.ro@example.com");
    const panel = bookingPanel(page);
    await expect(slotButtons(panel).first()).toBeVisible();
    const label = (await slotButtons(panel).nth(1).innerText()).trim();
    await slotButtons(panel).nth(1).click();
    await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();

    await kill(proc);                                   // ---- crash ----
    await page.reload();
    await expect(page.getByText("Unreachable")).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();

    proc = startBackend(dataDir);                       // ---- restart on the SAME data directory ----
    await healthy();
    await page.reload();
    await expect(page.getByText("Connected")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    // the checkpoint survived the SIGKILL: same step, same slot, same details
    await expect(panel).toContainText("Kim Ro");
    await expect(panel).toContainText("kim.ro@example.com");
    await expect(panel).toContainText(label);
    await panel.getByRole("button", { name: "Confirm", exact: true }).click();
    const refLoc = panel.getByText(/^#REV-[A-Z0-9]{6}$/);
    await expect(refLoc).toBeVisible();
    const ref = (await refLoc.innerText()).slice(1);

    await kill(proc);                                   // crash again AFTER the booking: it must be durable
    proc = startBackend(dataDir);
    await healthy();
    const rec = await (await request.get(`${API}/api/bookings/${ref}`)).json();
    expect(rec.status).toBe("confirmed");
    expect(rec.slot_label).toBe(label);
    await page.reload();
    await expect(panel.getByText(`#${ref}`)).toBeVisible();
  } finally {
    if (proc.exitCode === null) await kill(proc);
  }
});
