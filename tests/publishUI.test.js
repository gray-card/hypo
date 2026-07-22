import { describe, it, expect, beforeEach } from "vitest";
import { openPublishSetup } from "../src/ui/publishUI.js";
import { mockAgent } from "./setup.js";

const DID = "did:plc:test";
const buttons = (modal) => [...modal.querySelectorAll("button")].map((b) => b.textContent);

beforeEach(() => { document.body.innerHTML = ""; });

describe("Discover listing modal", () => {
  it("offers publishing when the user is not listed yet", async () => {
    await openPublishSetup(mockAgent(), DID, { handle: "alice.test", existing: null });
    const modal = document.querySelector(".modal");
    expect(modal.querySelector("h2").textContent).toBe("Publish to Discover");
    expect(buttons(modal)).toContain("Publish to Discover");
    // nothing to remove when nothing is published
    expect(buttons(modal).join(" ")).not.toMatch(/Remove from Discover/);
    // name is seeded from the handle so publishing is one click
    expect(modal.querySelector('input[type="text"]').value).toBe("@alice.test's setup");
  });

  it("becomes an edit form once the user is listed", async () => {
    const existing = {
      uri: `at://${DID}/app.graycard.setup/x`, cid: "c1", rkey: "x",
      value: { name: "My 35mm kit", summary: "Tri-X and an F2" },
    };
    await openPublishSetup(mockAgent(), DID, { handle: "alice.test", existing });
    const modal = document.querySelector(".modal");
    expect(modal.querySelector("h2").textContent).toBe("Edit profile");
    expect(buttons(modal)).toContain("Save changes");
    expect(buttons(modal)).toContain("Remove from Discover");
    // and it round-trips what is already published
    expect(modal.querySelector('input[type="text"]').value).toBe("My 35mm kit");
    expect(modal.querySelector("textarea").value).toBe("Tri-X and an F2");
  });

  it("saving an edit updates the existing record in place", async () => {
    const agent = mockAgent();
    const existing = {
      uri: `at://${DID}/app.graycard.setup/x`, cid: "c1", rkey: "x",
      value: { name: "old", createdAt: "2020-01-01T00:00:00Z" },
    };
    let changed;
    await openPublishSetup(agent, DID, { existing, onChange: (s) => { changed = s; } });
    const modal = document.querySelector(".modal");
    modal.querySelector('input[type="text"]').value = "new name";
    buttons(modal); // materialize
    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save changes").click();

    await new Promise((r) => setTimeout(r, 0));
    expect(agent.created).toHaveLength(0);          // updated, not re-created
    expect(agent.put).toHaveLength(1);
    expect(agent.put[0].rkey).toBe("x");
    expect(agent.put[0].record.name).toBe("new name");
    expect(agent.put[0].record.createdAt).toBe("2020-01-01T00:00:00Z");
    expect(changed?.value?.name).toBe("new name");
  });
});
