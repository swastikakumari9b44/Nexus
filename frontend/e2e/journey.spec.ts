import { bookingPanel, BACKEND, composer, expect, freshThread, send, settled, shot, slotButtons, test, threadId, availableSlots } from "./fixtures";

test("critical user journey: book -> FAQ interrupt -> confirm -> refresh -> isolation", async ({ page, request }) => {
  // 1-2. open, start a new conversation
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "How can NEXUS help?" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible();
  await shot(page, "01-empty-state-desktop");
  const t0 = await threadId(page);
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect.poll(() => threadId(page)).not.toBe(t0);
  const t1 = (await threadId(page))!;
  await expect(page.getByTitle("Copy thread ID")).toContainText(t1);

  // 3. ask to book
  await send(page, "Hi, I need to book a 1-on-1 Performance Review session.");
  await expect(page.getByText("May I have your full name and your email address?")).toBeVisible();
  const panel = bookingPanel(page);
  await expect(panel.getByLabel("Full name")).toBeVisible();
  await shot(page, "02-booking-collecting");

  // 4. provide name + email
  await send(page, "My name is Alex Chen and my email is alex.chen@example.com");
  await expect(slotButtons(panel)).toHaveCount(5);
  await expect(panel).toContainText("Alex Chen · alex.chen@example.com");

  // 5-7. interrupt with a handbook question: real citation, booking intact
  await send(page, "How often are performance reviews conducted?");
  const chip = page.getByRole("button", { name: /Open source: employee_handbook\.pdf, page 4/ });
  await expect(chip).toBeVisible();
  await expect(page.getByText(/conducted annually/)).toBeVisible();
  await expect(page.getByText(/Returning to your booking, Alex/)).toBeVisible();
  await expect(slotButtons(panel)).toHaveCount(5);
  await expect(panel).toContainText("Alex Chen · alex.chen@example.com");
  await settled(page);
  await shot(page, "03-faq-citation-booking-intact");

  // citation -> source details panel with the retrieved passage
  await chip.click();
  const dlg = page.getByRole("dialog", { name: "Source details" });
  await expect(dlg).toContainText("employee_handbook.pdf");
  await expect(dlg).toContainText("Page 4");
  await expect(dlg).toContainText(/annual/i);
  await shot(page, "04-source-panel");
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);

  // 8-9. select a slot, confirm
  const btn = slotButtons(panel).nth(1);
  const label = (await btn.innerText()).trim();
  await btn.click();
  const confirm = panel.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeVisible();
  await expect(panel).toContainText(label);
  await shot(page, "05-confirm-step");
  await confirm.click();
  const refLoc = panel.getByText(/^#REV-[A-Z0-9]{6}$/);
  await expect(refLoc).toBeVisible();
  const ref = (await refLoc.innerText()).slice(1);
  await expect(page.getByText("Confirmed!")).toBeVisible();
  await settled(page);
  await shot(page, "06-booking-confirmed");

  // 10. the reference is the actually persisted one
  const rec = await (await request.get(`${BACKEND}/api/bookings/${ref}`)).json();
  expect(rec.status).toBe("confirmed");
  expect(rec.slot_label).toBe(label);
  expect((await availableSlots(request)).map((s) => s.label)).not.toContain(label);

  // 11-12. refresh: conversation + completed booking restored, citation chip included
  await page.reload();
  await expect(panel.getByText(`#${ref}`)).toBeVisible();
  await expect(page.getByText("Confirmed!")).toBeVisible();
  await expect(page.getByText("Hi, I need to book a 1-on-1 Performance Review session.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Open source: employee_handbook\.pdf, page 4/ })).toBeVisible();
  expect(await threadId(page)).toBe(t1);
  await shot(page, "07-restored-after-refresh");

  // 13. a separate conversation shares nothing
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByRole("heading", { name: "How can NEXUS help?" })).toBeVisible();
  const t2 = (await threadId(page))!;
  expect(t2).not.toBe(t1);
  await expect(panel.getByRole("button", { name: "Start booking" })).toBeVisible();
  await expect(page.getByText("Alex Chen")).toHaveCount(0);
  const other = await (await request.get(`${BACKEND}/api/threads/${t2}`)).json();
  expect(other.exists).toBe(false);
  await send(page, "hello");
  await expect(page.getByText(/I can answer questions about the Employee Handbook/)).toBeVisible();
  const other2 = await (await request.get(`${BACKEND}/api/threads/${t2}`)).json();
  expect(other2.booking.status).toBe("idle");
  expect(other2.booking.name).toBeNull();

  // thread switching: go back to the first conversation
  await page.evaluate((id) => localStorage.setItem("nexus.thread_id", id), t1);
  await page.reload();
  await expect(panel.getByText(`#${ref}`)).toBeVisible();
  await expect(composer(page)).toBeVisible();
});

test("sample dialogue in a single message (name + email + FAQ together)", async ({ page }) => {
  await freshThread(page);
  await send(page, "Hi, I need to book a 1-on-1 Performance Review session.");
  await expect(page.getByText("May I have your full name and your email address?")).toBeVisible();
  await send(page, "Alex Chen (alex.chen@example.com). Wait, before that, how often are performance reviews conducted according to the handbook?");
  await expect(page.getByText(/conducted annually/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Open source: employee_handbook\.pdf, page 4/ })).toBeVisible();
  const panel = bookingPanel(page);
  await expect(page.getByText(/Returning to your booking, Alex/)).toBeVisible();
  await expect(slotButtons(panel)).toHaveCount(5);
  await send(page, "Let's go with option 2");
  await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await send(page, "yes");
  await expect(panel.getByText(/^#REV-[A-Z0-9]{6}$/)).toBeVisible();
});

test("invalid inputs: bad email via chat, form validation, empty message", async ({ page, diag }) => {
  await freshThread(page);
  const panel = bookingPanel(page);
  // empty / whitespace messages never reach the server
  const sendBtn = page.getByRole("button", { name: "Send message" });
  await expect(sendBtn).toBeDisabled();
  await composer(page).fill("   ");
  await expect(sendBtn).toBeDisabled();
  await composer(page).press("Enter");
  expect(diag.streamRequests).toBe(0);

  await send(page, "I want to book a performance review");
  await expect(panel.getByLabel("Full name")).toBeVisible();
  const before = diag.streamRequests;
  // client-side validation blocks bad form values with no request
  await panel.getByLabel("Full name").fill("Alex");
  await panel.getByLabel("Work email").fill("not-an-email");
  await panel.getByRole("button", { name: "Continue" }).click();
  await expect(panel.getByText("Enter your first and last name.")).toBeVisible();
  await expect(panel.getByText("Enter a valid email address.")).toBeVisible();
  expect(diag.streamRequests).toBe(before);
  // an invalid email typed in chat is rejected deterministically by the backend
  await send(page, "Alex Chen, alex.chen@example");
  await expect(page.getByText(/doesn't look valid/)).toBeVisible();
  await expect(panel.getByLabel("Full name")).toHaveValue("Alex Chen");
  await expect(slotButtons(panel)).toHaveCount(0);
  // correcting it moves on
  await send(page, "sorry, it's alex.chen@example.com");
  await expect(slotButtons(panel)).toHaveCount(5);
});
