import { describe, it, expect, beforeEach, vi } from "vitest";
import { initLibrary, refreshStore, openAddGear, openEditGear, renderLibrary, effectiveShootGear } from "../src/ui/library.js";
import { NS } from "../src/graycard.js";
import { mockAgent } from "./setup.js";

let agent;
beforeEach(async () => {
  document.body.innerHTML = "";
  agent = mockAgent();
  initLibrary({ agent, did: "did:plc:test" });
  await refreshStore(); // empty store from the mock agent
});

const labelInput = (root, prefix) => {
  const lab = [...root.querySelectorAll("label.field")].find((l) => l.querySelector("span")?.textContent.startsWith(prefix));
  return lab?.querySelector("input, select, textarea");
};

describe("openAddGear — the add-gear form (types hidden)", () => {
  it("splits camera into 'which camera' identity and 'your copy', never says 'type'", () => {
    openAddGear("camera", () => {});
    const modal = document.querySelector(".modal");
    const subs = [...modal.querySelectorAll(".modal-sub")].map((s) => s.textContent);
    expect(subs[0]).toMatch(/which camera/i);
    // identity first, your copy after; the model's shared picture/datasheet
    // section sits between them, so assert order rather than exact position.
    const mine = subs.findIndex((s) => /your copy/i.test(s));
    expect(mine).toBeGreaterThan(0);
    expect(modal.textContent).not.toMatch(/\btype\b/i);
    // identity fields present
    expect(labelInput(modal, "Make")).toBeTruthy();
    expect(labelInput(modal, "Model")).toBeTruthy();
    // custom (not native datalist) autocomplete wired on make + preset field
    expect(modal.querySelector("input[list]")).toBeFalsy();
    expect(modal.querySelectorAll(".ac-menu").length).toBeGreaterThanOrEqual(2);
  });

  it("renders human-labelled enum menus (mount names keep proper casing)", () => {
    openAddGear("camera", () => {});
    const mount = labelInput(document.querySelector(".modal"), "Mount");
    const opts = [...mount.options].map((o) => o.textContent);
    expect(opts).toContain("Nikon F");
    expect(opts).not.toContain("nikon f");
  });

  it("puts the reserve count on the stockpile, and shot fields on the roll", () => {
    openAddGear("filmStockpile", () => {});
    let modal = document.querySelector(".modal");
    expect(labelInput(modal, "How many rolls in reserve")).toBeTruthy();
    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Cancel")?.click();

    openAddGear("filmRoll", () => {});
    modal = document.querySelector(".modal");
    expect(labelInput(modal, "Status")).toBeTruthy();
    expect(labelInput(modal, "Shot at ISO (push/pull)")).toBeTruthy();
    expect(labelInput(modal, "How many rolls in reserve")).toBeFalsy(); // reserve lives on the stockpile now
  });

  it("autofills mount + format from the picked model (make-conditioned)", () => {
    openAddGear("camera", () => {});
    const modal = document.querySelector(".modal");
    const make = labelInput(modal, "Make");
    const model = labelInput(modal, "Model");
    const mount = labelInput(modal, "Mount");
    const format = labelInput(modal, "Format");
    make.value = "Nikon"; make.dispatchEvent(new Event("input"));
    model.value = "Z6 II"; model.dispatchEvent(new Event("input"));
    expect(mount.value).toBe("Nikon Z");
    expect(format.value).toBe("full-frame-digital");
  });

  it("auto-creates the catalog type behind the instance on save", async () => {
    const onDone = vi.fn();
    openAddGear("camera", onDone);
    const modal = document.querySelector(".modal");
    labelInput(modal, "Make").value = "Leica";
    labelInput(modal, "Model").value = "M6";
    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save").click();

    await vi.waitFor(() => expect(agent.created.length).toBe(2));
    expect(agent.created[0].collection).toBe(NS.catalog.cameraType);
    expect(agent.created[1].collection).toBe(NS.instance.camera);
    // the instance points at the freshly-created type
    const typeUri = "at://did:plc:test/app.graycard.catalog.cameraType/rk1";
    expect(agent.created[1].record.type).toBe(typeUri);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("saves a picture and datasheet link onto the catalog type, not the copy", async () => {
    openAddGear("camera", () => {});
    const modal = document.querySelector(".modal");
    labelInput(modal, "Make").value = "Leica";
    labelInput(modal, "Model").value = "M6";
    labelInput(modal, "Picture link").value = "https://leica.example/m6-box.jpg";
    labelInput(modal, "Datasheet link").value = "https://leica.example/m6.pdf";
    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save").click();

    await vi.waitFor(() => expect(agent.created.length).toBe(2));
    const type = agent.created[0];
    expect(type.collection).toBe(NS.catalog.cameraType);
    expect(type.record.image).toEqual({ url: "https://leica.example/m6-box.jpg" });
    expect(type.record.datasheet).toEqual({ url: "https://leica.example/m6.pdf" });
    // the model's assets must not leak onto the user's own copy
    expect(agent.created[1].record.image).toBeUndefined();
    expect(agent.created[1].record.datasheet).toBeUndefined();
  });

  it("carries a rebranded film's aka onto the saved stock record", async () => {
    openAddGear("filmRoll", () => {});
    const modal = document.querySelector(".modal");
    labelInput(modal, "Brand").value = "Kodak";
    const nameInput = labelInput(modal, "Name");
    nameInput.value = "Portra 400";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));   // fires applyPreset
    // the "also sold as" hint appears for a rebranded stock
    const hint = modal.querySelector(".aka-hint");
    expect(hint).toBeTruthy();
    expect(hint.classList.contains("hidden")).toBe(false);
    expect(hint.textContent).toMatch(/Ektacolor Pro 400/);

    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save").click();
    await vi.waitFor(() => expect(agent.created.length).toBe(2));
    const stock = agent.created.find((c) => c.collection === NS.catalog.filmStock);
    expect(stock, "a filmStock type was created").toBeTruthy();
    expect(stock.record.aka).toContain("Ektacolor Pro 400");
  });

  it("leaves the type's assets unset when the picture fields are blank", async () => {
    openAddGear("camera", () => {});
    const modal = document.querySelector(".modal");
    labelInput(modal, "Make").value = "Leica";
    labelInput(modal, "Model").value = "M6";
    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save").click();

    await vi.waitFor(() => expect(agent.created.length).toBe(2));
    // blank means "keep the curated/Wikidata picture", not an empty override
    expect(agent.created[0].record.image).toBeUndefined();
    expect(agent.created[0].record.datasheet).toBeUndefined();
  });
});

describe("openEditGear — editing an existing copy", () => {
  it("prefills identity + copy and updates the same record in place", async () => {
    const typeUri = "at://did:plc:test/app.graycard.catalog.cameraType/rkT";
    initLibrary({
      agent, did: "did:plc:test",
      store: {
        catalog: { cameraType: [{ uri: typeUri, cid: "cidT", rkey: "rkT", value: { make: "Leica", model: "M6" } }] },
        instance: { camera: [] },
      },
    });
    const item = {
      uri: "at://did:plc:test/app.graycard.instance.camera/rkI", cid: "cidI", rkey: "rkI",
      value: { type: typeUri, nickname: "black M6", serialNumber: "123", createdAt: "2020-01-01T00:00:00.000Z" },
    };
    const onDone = vi.fn();
    openEditGear("camera", item, onDone);

    const modal = document.querySelector(".modal");
    expect(modal.textContent).toMatch(/edit camera/i);
    expect(labelInput(modal, "Make").value).toBe("Leica");
    expect(labelInput(modal, "Model").value).toBe("M6");
    expect(labelInput(modal, "Nickname").value).toBe("black M6");

    labelInput(modal, "Nickname").value = "silver M6";
    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save").click();

    await vi.waitFor(() => expect(agent.put.length).toBe(1));
    const rec = agent.put[0];
    expect(rec.collection).toBe(NS.instance.camera);
    expect(rec.rkey).toBe("rkI");                            // same record, not a new one
    expect(rec.record.nickname).toBe("silver M6");
    expect(rec.record.type).toBe(typeUri);                  // reused the existing type
    expect(rec.record.createdAt).toBe("2020-01-01T00:00:00.000Z"); // createdAt preserved
    expect(rec.record.updatedAt).toBeTruthy();
    expect(agent.created.length).toBe(0);                   // nothing new created
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe("shoots inherit gear from the photos they contain", () => {
  it("effective gear = explicitly added + gear used by the shoot's exposures", () => {
    const camA = "at://did:plc:test/app.graycard.instance.camera/rkA";
    const camB = "at://did:plc:test/app.graycard.instance.camera/rkB";
    const lensX = "at://did:plc:test/app.graycard.instance.lens/rkX";
    initLibrary({
      agent, did: "did:plc:test",
      store: {
        instance: {
          camera: [{ uri: camA, value: {} }, { uri: camB, value: {} }],
          lens: [{ uri: lensX, value: {} }],
          exposure: [
            { uri: "at://e1", value: { shoot: "at://S", camera: camB, lens: lensX } }, // uses camB + lensX
            { uri: "at://e2", value: { shoot: "at://other", camera: camA } },           // a different shoot
          ],
        },
      },
    });
    const shoot = { uri: "at://S", value: { cameras: [camA] } };      // explicitly added camA only
    expect(effectiveShootGear(shoot, "camera").sort()).toEqual([camA, camB].sort()); // camB inherited
    expect(effectiveShootGear(shoot, "lens")).toEqual([lensX]);        // lens inherited from the exposure
  });
});

describe("filmRoll camera assignment in the gear form", () => {
  it("exposes a camera picker on the roll form, prefills it, and saves it in place", async () => {
    const stockUri = "at://did:plc:test/app.graycard.catalog.filmStock/rkF";
    const camUri = "at://did:plc:test/app.graycard.instance.camera/rkC";
    initLibrary({
      agent, did: "did:plc:test",
      store: {
        catalog: { filmStock: [{ uri: stockUri, cid: "cidF", rkey: "rkF", value: { brand: "Kodak", name: "Portra 400" } }] },
        instance: { camera: [{ uri: camUri, cid: "cidC", rkey: "rkC", value: { nickname: "black M6" } }] },
      },
    });
    const item = {
      uri: "at://did:plc:test/app.graycard.instance.filmRoll/rkR", cid: "cidR", rkey: "rkR",
      value: { stock: stockUri, status: "loaded", camera: camUri, createdAt: "2026-01-01T00:00:00.000Z" },
    };
    openEditGear("filmRoll", item, () => {});
    const modal = document.querySelector(".modal");
    const camField = labelInput(modal, "Camera");
    expect(camField.tagName).toBe("SELECT");            // a body picker, not a text box
    expect(camField.value).toBe(camUri);                // prefilled to the loaded camera

    [...modal.querySelectorAll("button")].find((b) => b.textContent === "Save").click();
    await vi.waitFor(() => expect(agent.put.length).toBe(1));
    expect(agent.put[0].collection).toBe(NS.instance.filmRoll);
    expect(agent.put[0].rkey).toBe("rkR");              // same record
    expect(agent.put[0].record.camera).toBe(camUri);    // camera preserved
    expect(agent.created.length).toBe(0);               // reused the existing stock
  });
});

describe("renderLibrary — Setup with per-category gear tabs", () => {
  it("splits cameras/lenses/film into their own tabs (plus activity tabs)", async () => {
    const body = document.createElement("div");
    document.body.append(body);
    await renderLibrary(body);

    const tabs = [...body.querySelectorAll(".tab-btn")].map((b) => b.textContent);
    expect(tabs).toEqual(["Cameras", "Lenses", "Filters", "Film", "Shoots", "Darkroom", "Scanning", "Workflows", "Rules", "Insights"]);
  });

  it("defaults to the Cameras tab and shows only cameras, no camelCase", async () => {
    const body = document.createElement("div");
    document.body.append(body);
    await renderLibrary(body);

    const headings = [...body.querySelectorAll(".gear-section h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Cameras"]); // only the active tab's category
    expect(body.querySelector(".add-gear").textContent).toMatch(/add camera/i);
    expect(body.textContent).not.toMatch(/cameraType|filmStock|developerType|filmRoll/);
  });

  it("the Film tab splits reserve stockpile from physical rolls", async () => {
    const body = document.createElement("div");
    document.body.append(body);
    body.dataset.tab = "film";
    await renderLibrary(body);
    const headings = [...body.querySelectorAll(".gear-section h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Film in reserve", "Rolls"]);
  });
});
