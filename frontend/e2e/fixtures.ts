import { expect, test as base, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const BACKEND = "http://127.0.0.1:8000";

export interface Diag {
  pageErrors: string[]; consoleErrors: string[]; badResponses: string[]; failedRequests: string[];
  streamRequests: number;
  /** Declare network failures that THIS test causes on purpose (matched against the error text). */
  allowFailed: (re: RegExp) => void;
  /** Declare HTTP error statuses a test expects, e.g. /^422 /. */
  allowStatus: (re: RegExp) => void;
  /** Declare expected console errors (e.g. the browser's own CORS block message). */
  allowConsole: (re: RegExp) => void;
}

/** Every test automatically fails on uncaught browser errors, unexpected failed/4xx/5xx API calls. */
export const test = base.extend<{ diag: Diag }>({
  diag: [async ({ page }, use) => {
    const failedOk: RegExp[] = []; const statusOk: RegExp[] = []; const consoleOk: RegExp[] = [];
    const d: Diag = {
      pageErrors: [], consoleErrors: [], badResponses: [], failedRequests: [], streamRequests: 0,
      allowFailed: (re) => failedOk.push(re), allowStatus: (re) => statusOk.push(re), allowConsole: (re) => consoleOk.push(re),
    };
    page.on("pageerror", (e) => d.pageErrors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) d.consoleErrors.push(m.text()); });
    page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) d.badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
    page.on("requestfailed", (r) => { if (r.url().includes("/api/")) d.failedRequests.push(`${r.failure()?.errorText} ${r.url()}`); });
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/chat/stream")) d.streamRequests++; });
    page.on("dialog", (dlg) => { d.pageErrors.push(`unexpected browser dialog: ${dlg.message()}`); void dlg.dismiss(); });
    await use(d);
    expect(d.pageErrors, "uncaught browser errors").toEqual([]);
    expect(d.consoleErrors.filter((x) => !consoleOk.some((re) => re.test(x))), "console errors").toEqual([]);
    expect(d.badResponses.filter((x) => !statusOk.some((re) => re.test(x))), "unexpected HTTP error responses").toEqual([]);
    expect(d.failedRequests.filter((x) => !failedOk.some((re) => re.test(x))), "unexpected failed API requests").toEqual([]);
  }, { auto: true }],
});
export { expect };

export const composer = (p: Page) => p.locator("#composer");
export const bookingPanel = (p: Page) => p.getByRole("region", { name: "Booking" });
export const slotButtons = (panel: Locator) => panel.getByRole("button", { name: /IST/ });
export const threadId = (p: Page) => p.evaluate(() => localStorage.getItem("nexus.thread_id"));

export async function send(p: Page, text: string) {
  await expect(p.getByRole("status")).toHaveCount(0);      // the composer ignores Enter while a turn is in flight
  await composer(p).fill(text);
  await composer(p).press("Enter");
}
/** Wait until the in-flight badge is gone (the turn finished). */
export async function settled(p: Page) {
  await expect(p.getByRole("status")).toHaveCount(0);
}
export async function freshThread(p: Page) {
  await p.goto("/");
  await expect(p.getByRole("heading", { name: "How can NEXUS help?" })).toBeVisible();
  await p.getByRole("button", { name: "New conversation" }).click();
  await expect(p.getByRole("heading", { name: "How can NEXUS help?" })).toBeVisible();
}
export async function shot(p: Page, name: string) {
  await p.screenshot({ path: `../docs/screenshots/${name}.png` });
}
export async function availableSlots(request: APIRequestContext): Promise<{ id: string; label: string }[]> {
  return (await (await request.get(`${BACKEND}/api/slots`)).json()).slots;
}
/** Books a slot through the REAL API in a separate conversation (another user taking it). */
export async function bookViaApi(request: APIRequestContext, slotId: string): Promise<string> {
  const t = crypto.randomUUID();
  const post = async (message: string, extra: object = {}) =>
    (await request.post(`${BACKEND}/api/chat`, { data: { thread_id: t, message, ...extra } })).json();
  await post("book a performance review");
  await post("Other Person other.person@example.com");
  await post("take this one", { slot_id: slotId });
  const j = await post("yes");
  expect(j.booking.status).toBe("confirmed");
  return j.booking.reference as string;
}
/** Drive the UI from a fresh thread up to the awaiting-confirmation step. Returns the chosen slot label. */
export async function toConfirmation(p: Page, slotIndex = 0, name = "Alex Chen", email = "alex.chen@example.com") {
  await freshThread(p);
  await send(p, "Hi, I need to book a 1-on-1 Performance Review session.");
  await expect(p.getByText("May I have your full name and your email address?")).toBeVisible();
  await send(p, `My name is ${name} and my email is ${email}`);
  const panel = bookingPanel(p);
  await expect(slotButtons(panel).first()).toBeVisible();
  const btn = slotButtons(panel).nth(slotIndex);
  const label = (await btn.innerText()).trim();
  await btn.click();
  await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  return label;
}

/** Fresh thread without the sidebar button (it lives in a drawer on small screens). */
export async function freshThreadByStorage(p: Page) {
  await p.goto("/");
  await p.evaluate((id) => localStorage.setItem("nexus.thread_id", id), crypto.randomUUID());
  await p.reload();
  await expect(p.getByRole("heading", { name: "How can NEXUS help?" })).toBeVisible();
}
