// Network emulation can change transport availability before delivering the
// browser's connectivity event. Exercise both parts of the transition before
// continuing the user journey, as the offline queue responds to those events.
export async function setBrowserOffline(page, context, offline) {
  await context.setOffline(offline);
  await page.evaluate((value) => window.dispatchEvent(new Event(value ? "offline" : "online")), offline);
}
