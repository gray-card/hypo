import { beforeEach, expect, it, vi } from "vitest";
import { renderLibraryShell, type LibraryShellServices } from "../apps/web/src/views/library/maintenance-shell.ts";

beforeEach(() => document.body.replaceChildren());

it("preserves an open mobile menu across refresh and closes it when selecting a section", async () => {
  const body = document.createElement("div");
  document.body.append(body);
  const services: LibraryShellServices = {
    navigationGroups: [
      {
        label: "Library",
        items: [
          { id: "overview", label: "Overview" },
          { id: "chemistry", label: "Chemistry" },
        ],
      },
    ],
    gearTabs: { chemistry: ["chemistry"] },
    defaultTab: "overview",
    hasStore: () => true,
    loadStore: async () => {},
    matches: () => true,
    renderOverview: vi.fn(),
    renderFilmReserve: vi.fn(),
    renderGear: vi.fn(),
    renderWorkflowTemplates: vi.fn(),
    renderBatchRules: vi.fn(),
    renderDataQuality: vi.fn(),
  };
  await renderLibraryShell(body, services);
  const original = body.querySelector<HTMLDetailsElement>(".library-navigation-mobile")!;
  original.open = true;
  await renderLibraryShell(body, services);
  const refreshed = body.querySelector<HTMLDetailsElement>(".library-navigation-mobile")!;
  expect(refreshed).not.toBe(original);
  expect(refreshed.open).toBe(true);
  const chemistry = [...refreshed.querySelectorAll("button")].find((button) => button.textContent === "Chemistry")!;
  chemistry.click();
  expect(body.dataset.tab).toBe("chemistry");
  expect(body.querySelector<HTMLDetailsElement>(".library-navigation-mobile")!.open).toBe(false);
  expect(services.renderGear).toHaveBeenCalledWith(expect.any(HTMLElement), ["chemistry"]);
});
