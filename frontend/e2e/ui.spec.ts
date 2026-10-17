import { bookingPanel, composer, expect, freshThread, freshThreadByStorage, send, settled, shot, test } from "./fixtures";

const LABEL: Record<string, string> = { router: "Router", rag: "Knowledge (RAG)", booking: "Booking", clarify: "Clarify", finalize: "Respond" };

test("live node status is driven by real backend events and matches the final trace", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __badge: string[]; __chips: string[] };
    w.__badge = []; w.__chips = [];
    new MutationObserver(() => {
      const el = document.querySelector('[role="status"]');
      if (!el) return;
      const t = (el.textContent ?? "").trim();
      if (t && w.__badge[w.__badge.length - 1] !== t) w.__badge.push(t);
      const c = (el.parentElement?.textContent ?? "").trim();
      if (c && w.__chips[w.__chips.length - 1] !== c) w.__chips.push(c);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await freshThread(page);
  const resp = page.waitForResponse((r) => r.url().includes("/api/chat/stream"));
  await send(page, "How often are performance reviews conducted?");
  await expect(page.getByText(/conducted annually/)).toBeVisible();
  await settled(page);
  const body = await (await resp).text();
  const finalJson = JSON.parse(body.split("event: final\ndata: ")[1].split("\n\n")[0]);
  const nodeEvents = [...body.matchAll(/event: node\ndata: (\{.*\})/g)].map((m) => JSON.parse(m[1]).node);
  expect(nodeEvents).toEqual(["router", "rag", "finalize"]);
  expect(finalJson.trace).toEqual(["router", "rag", "finalize"]);
  const seen = await page.evaluate(() => (window as unknown as { __badge: string[] }).__badge);
  const chips = await page.evaluate(() => (window as unknown as { __chips: string[] }).__chips);
  // the badge walked through the stages as the events arrived (not a canned animation)
  const idx = (s: string) => seen.findIndex((x) => x.includes(s));
  expect(idx("Routing request")).toBeGreaterThanOrEqual(0);
  expect(idx("Retrieving handbook knowledge")).toBeGreaterThan(idx("Routing request"));
  expect(idx("Composing answer")).toBeGreaterThan(idx("Retrieving handbook knowledge"));
  expect(chips.some((c) => c.includes("router ✓")) && chips.some((c) => c.includes("rag ✓"))).toBe(true);
  // after the turn, the header shows exactly the nodes the backend reported
  await expect(page.locator("main header")).toContainText(finalJson.trace.map((n: string) => LABEL[n]).join(" → "));
});

test("booking flow shows the booking-specific stage ('Preparing booking'), not the RAG one", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __badge: string[] }; w.__badge = [];
    new MutationObserver(() => {
      const t = (document.querySelector('[role="status"]')?.textContent ?? "").trim();
      if (t && w.__badge[w.__badge.length - 1] !== t) w.__badge.push(t);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await freshThread(page);
  await send(page, "I need to book a performance review");
  await expect(page.getByText(/May I have your full name/)).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { __badge: string[] }).__badge);
  expect(seen.some((x) => x.includes("Preparing booking"))).toBe(true);
  expect(seen.some((x) => x.includes("Retrieving handbook knowledge"))).toBe(false);
});

test("markdown/HTML in messages is inert (no injected elements, no script execution, no javascript: links)", async ({ page }) => {
  await freshThread(page);
  const evil = '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> <a href="javascript:window.__xss=3">h</a> **bold** [md](javascript:window.__xss=4)';
  await send(page, evil);
  const log = page.getByRole("log");
  await expect(log.locator("strong", { hasText: "bold" })).toBeVisible();      // markdown still renders
  await expect(page.getByText(/I can answer questions about the Employee Handbook/)).toBeVisible();
  expect(await log.locator("img, script, iframe, object, embed").count()).toBe(0);
  const hrefs = await log.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.filter((h) => h.toLowerCase().startsWith("javascript:"))).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  // the literal text is shown to the user, not interpreted
  await expect(log).toContainText("<img src=x");
});

test.describe("mobile (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("drawer keeps focus while the page re-renders; Esc closes and restores focus", async ({ page }) => {
    await freshThreadByStorage(page);
    await send(page, "book a performance review");
    await expect(page.getByText(/May I have your full name/)).toBeVisible();
    const trigger = page.getByRole("button", { name: /^Booking/ });
    await trigger.click();
    const dlg = page.getByRole("dialog", { name: "Booking" });
    const name = dlg.getByLabel("Full name");
    await name.click();
    await name.pressSequentially("Ale");
    await expect(name).toBeFocused();
    // the app re-renders on every health poll (15 s): focus and typed text must survive it
    await page.waitForResponse((r) => r.url().includes("/api/health"), { timeout: 25_000 });
    await page.waitForTimeout(400);
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Ale");
    await name.pressSequentially("x Chen");
    await expect(name).toHaveValue("Alex Chen");
    await shot(page, "12-mobile-booking-drawer");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test("responsive layouts: desktop / tablet / mobile (no horizontal overflow, correct chrome)", async ({ page }) => {
  const sizes = [
    { name: "desktop", w: 1440, h: 900, sidebar: true, aside: true },
    { name: "tablet", w: 820, h: 1180, sidebar: false, aside: false },
    { name: "mobile", w: 390, h: 844, sidebar: false, aside: false },
  ];
  for (const s of sizes) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await freshThreadByStorage(page);
    await send(page, "How often are performance reviews conducted?");
    await expect(page.getByText(/conducted annually/)).toBeVisible();
    await send(page, "x".repeat(140));                                  // one long unbroken token
    await expect(page.getByText(/I can answer questions about the Employee Handbook/)).toBeVisible();
    await settled(page);
    const m = await page.evaluate(() => {
      const log = document.querySelector('[role="log"]') as HTMLElement;
      const c = document.querySelector("#composer")!.getBoundingClientRect();
      return { docOverflow: document.documentElement.scrollWidth - window.innerWidth, logOverflow: log.scrollWidth - log.clientWidth,
               composerBottom: c.bottom, composerRight: c.right, vh: window.innerHeight, vw: window.innerWidth };
    });
    expect(m.docOverflow, `${s.name}: page overflows horizontally`).toBeLessThanOrEqual(0);
    expect(m.logOverflow, `${s.name}: chat log overflows horizontally`).toBeLessThanOrEqual(0);
    expect(m.composerBottom).toBeLessThanOrEqual(m.vh);
    expect(m.composerRight).toBeLessThanOrEqual(m.vw);
    await expect(page.getByRole("button", { name: "New conversation" })).toHaveCount(s.sidebar ? 1 : 0);
    await expect(bookingPanel(page)).toHaveCount(s.aside ? 1 : 0);
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(s.sidebar ? 0 : 1);
    await shot(page, `10-layout-${s.name}`);
    if (!s.sidebar) {
      await page.getByRole("button", { name: "Open menu" }).click();
      const menu = page.getByRole("dialog", { name: "Menu" });
      await expect(menu.getByRole("button", { name: "New conversation" })).toBeVisible();
      await expect(menu).toContainText("System status");
      if (s.name === "mobile") await shot(page, "11-mobile-menu");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    }
  }
});

test("keyboard: Enter sends, Shift+Enter inserts a newline, Tab reaches the controls", async ({ page }) => {
  await freshThread(page);
  await composer(page).fill("line one");
  await composer(page).press("Shift+Enter");
  await composer(page).pressSequentially("line two");
  await expect(composer(page)).toHaveValue("line one\nline two");
  await composer(page).press("Enter");
  await expect(page.getByRole("log").getByText("line one")).toBeVisible();
  await expect(composer(page)).toHaveValue("");
  await settled(page);
  await composer(page).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();   // empty composer: disabled, skipped by Tab
});

test.describe("CORS / API base URL", () => {
  test("direct build (VITE_API_BASE) works cross-origin from an allowed origin", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) apiCalls.push(r.url()); });
    await page.goto("http://127.0.0.1:4174/");
    await expect(page.getByText("Connected")).toBeVisible();
    await send(page, "How often are performance reviews conducted?");
    await expect(page.getByText(/conducted annually/)).toBeVisible();
    expect(apiCalls.length).toBeGreaterThan(2);
    expect(apiCalls.every((u) => u.startsWith("http://127.0.0.1:8000/api/"))).toBe(true);     // calls go straight to the backend
    expect(apiCalls.some((u) => u.includes("/api/chat/stream"))).toBe(true);
  });

  test("an origin that is NOT in CORS_ORIGINS is blocked by the browser", async ({ page, diag }) => {
    diag.allowFailed(/.*/); diag.allowConsole(/CORS|blocked|Access-Control/i);
    await page.goto("http://localhost:4174/");                       // same app, different (disallowed) origin
    await expect(page.getByText("Unreachable")).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();
  });
});
