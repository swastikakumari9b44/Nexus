import { BACKEND, availableSlots, bookViaApi, bookingPanel, composer, expect, send, settled, shot, slotButtons, test, threadId, toConfirmation, freshThread } from "./fixtures";

const RESET = /ERR_CONNECTION_RESET/;

test("dropped connection BEFORE the server sees the request: error + Retry re-sends the same id, processed once", async ({ page, request, diag }) => {
  await freshThread(page);
  diag.allowFailed(RESET);
  const bodies: Array<Record<string, unknown>> = [];
  let n = 0;
  await page.route("**/api/chat/stream", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (n++ === 0) return route.abort("connectionreset");
    return route.continue();
  });
  await send(page, "How often are performance reviews conducted?");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(/connection dropped/);
  await expect(page.getByText("Delivery unconfirmed")).toBeVisible();
  await shot(page, "08-error-with-retry");
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(/conducted annually/)).toBeVisible();
  await expect(alert).toHaveCount(0);
  await expect(page.getByText("Delivery unconfirmed")).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].client_message_id).toBe(bodies[0].client_message_id);
  // exactly one user message + one answer on the server, and only one user bubble in the UI
  const t = await threadId(page);
  const th = await (await request.get(`${BACKEND}/api/threads/${t}`)).json();
  expect(th.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  await expect(page.getByRole("log").getByText("How often are performance reviews conducted?", { exact: true })).toHaveCount(1);
});

test("response LOST AFTER the booking committed: UI reconciles with the server and never says it failed", async ({ page, request, diag }) => {
  const label = await toConfirmation(page, 2);
  const panel = bookingPanel(page);
  const slotsBefore = (await availableSlots(request)).length;
  diag.allowFailed(RESET);
  let hits = 0;
  await page.route("**/api/chat/stream", async (route) => {
    hits++;
    await route.fetch();                 // the REAL server processes the request and COMMITS the booking...
    await route.abort("connectionreset"); // ...but the browser never receives the response
  });
  await panel.getByRole("button", { name: "Confirm", exact: true }).click();
  // the UI asks the server what happened and adopts the committed result
  const refLoc = panel.getByText(/^#REV-[A-Z0-9]{6}$/);
  await expect(refLoc).toBeVisible();
  const ref = (await refLoc.innerText()).slice(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Delivery unconfirmed")).toHaveCount(0);
  await expect(page.getByText("Confirmed!")).toBeVisible();
  expect(hits).toBe(1);                  // no retry was needed
  const rec = await (await request.get(`${BACKEND}/api/bookings/${ref}`)).json();
  expect(rec.status).toBe("confirmed");
  expect(rec.slot_label).toBe(label);
  expect((await availableSlots(request)).length).toBe(slotsBefore - 1);   // exactly one booking was created
  await shot(page, "09-recovered-after-lost-response");
});

test("response lost AND the status lookup also fails: honest wording, Retry returns the SAME booking (no duplicate)", async ({ page, request, diag }) => {
  const label = await toConfirmation(page, 3);
  const panel = bookingPanel(page);
  const t = (await threadId(page))!;
  const slotsBefore = (await availableSlots(request)).length;
  diag.allowFailed(RESET);
  let lost = true;
  await page.route("**/api/chat/stream", async (route) => {
    if (lost) { await route.fetch(); lost = false; return route.abort("connectionreset"); }
    return route.continue();
  });
  let blockThreadLookup = true;
  await page.route("**/api/threads/**", (route) => blockThreadLookup ? route.abort("connectionreset") : route.continue());
  await panel.getByRole("button", { name: "Confirm", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(/connection dropped/);
  // the UI cannot know the outcome: it must not assert that the BOOKING failed, nor show a reference it doesn't have
  await expect(alert).not.toContainText(/booking (failed|was not)|not created|could not book/i);
  await expect(panel.getByText(/^#REV-/)).toHaveCount(0);
  // meanwhile the server DID commit
  blockThreadLookup = false;
  const serverView = await (await request.get(`${BACKEND}/api/threads/${t}`)).json();
  expect(serverView.booking.status).toBe("confirmed");
  const serverRef = serverView.booking.reference as string;
  // Retry re-sends the same client_message_id => stored reply, same reference
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(panel.getByText(`#${serverRef}`)).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect((await availableSlots(request)).length).toBe(slotsBefore - 1);
  const rec = await (await request.get(`${BACKEND}/api/bookings/${serverRef}`)).json();
  expect(rec.slot_label).toBe(label);
});

test("slot taken by someone else BEFORE selection: stale slot is refused, no booking", async ({ page, request }) => {
  await freshThread(page);
  await send(page, "book a performance review");
  await send(page, "My name is Sam Lee and my email is sam.lee@example.com");
  const panel = bookingPanel(page);
  await expect(slotButtons(panel).first()).toBeVisible();
  const slots = await availableSlots(request);
  const stale = slots[0];
  await bookViaApi(request, stale.id);                       // another user takes it (real API)
  await panel.getByRole("button", { name: new RegExp(stale.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  await expect(page.getByText(/no longer available/)).toBeVisible();
  await expect(panel.getByText(/^#REV-/)).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: stale.label })).toHaveCount(0);   // refreshed offer no longer lists it
  await expect(slotButtons(panel).first()).toBeVisible();
});

test("slot taken between choosing and confirming: conflict message, nothing booked, new choice possible", async ({ page, request }) => {
  const label = await toConfirmation(page, 1, "Dana Wu", "dana.wu@example.com");
  const panel = bookingPanel(page);
  const taken = (await availableSlots(request)).find((s) => s.label === label)!;
  await bookViaApi(request, taken.id);                       // the conflict
  await panel.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(/that slot was just taken, so nothing was booked/)).toBeVisible();
  await expect(panel.getByText(/^#REV-/)).toHaveCount(0);
  await expect(slotButtons(panel).first()).toBeVisible();
  await expect(panel.getByRole("button", { name: label })).toHaveCount(0);
  // the user can pick another slot and complete
  await slotButtons(panel).first().click();
  await panel.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(panel.getByText(/^#REV-[A-Z0-9]{6}$/)).toBeVisible();
});

test("repeated submission: second Enter while in flight is ignored and the text is kept", async ({ page, diag }) => {
  await freshThread(page);
  await send(page, "How often are performance reviews conducted?");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await composer(page).fill("a second message typed while waiting");
  await composer(page).press("Enter");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("a second message typed while waiting");     // not lost, not sent
  await expect(page.getByText(/conducted annually/)).toBeVisible();
  await settled(page);
  expect(diag.streamRequests).toBe(1);
  await expect(page.getByRole("log").getByText("a second message typed while waiting")).toHaveCount(0);   // never became a chat message
});

test("double-click on Confirm creates exactly one booking", async ({ page, request, diag }) => {
  await toConfirmation(page, 4, "Lee Park", "lee.park@example.com");
  const panel = bookingPanel(page);
  const slotsBefore = (await availableSlots(request)).length;
  const before = diag.streamRequests;
  await panel.getByRole("button", { name: "Confirm", exact: true }).dblclick();
  await expect(panel.getByText(/^#REV-[A-Z0-9]{6}$/)).toBeVisible();
  await settled(page);
  expect(diag.streamRequests - before).toBe(1);
  expect((await availableSlots(request)).length).toBe(slotsBefore - 1);
});
