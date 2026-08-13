import { describe, expect, it, vi } from "vitest";
import { createRecordStore } from "@hypo/store";
import { NS } from "../src/graycard.js";
import { renderEditorTemplatesOn } from "../src/ui/editor.ts";
import { renderOnboardingCollectionsOn } from "../src/ui/onboarding.ts";
import { renderProcessRecipesOn } from "../src/ui/processForms.ts";
import { renderProfileGearOn } from "../src/ui/profileView.ts";
import { renderSceneRecordsOn } from "../src/ui/sceneEditor.ts";

const repo = "did:plc:ui-section-signals";
const record = (collection: string, rkey: string) => ({
  uri: `at://${repo}/${collection}/${rkey}`,
  cid: `cid-${rkey}`,
  value: { name: rkey },
});

describe("signal-backed UI section boundaries", () => {
  it("rerenders Editor templates only for workflow-template changes", () => {
    const store = createRecordStore({ repo });
    const render = vi.fn();
    const dispose = renderEditorTemplatesOn(store, render);

    store.upsertRemote(NS.instance.camera, record(NS.instance.camera, "camera"));
    expect(render).toHaveBeenCalledOnce();
    store.upsertRemote(NS.workflow.template, record(NS.workflow.template, "template"));
    expect(render).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("rerenders Profile gear only for the displayed gear collections", () => {
    const store = createRecordStore({ repo });
    const render = vi.fn();
    const dispose = renderProfileGearOn(store, render);

    store.upsertRemote(NS.instance.chemistry, record(NS.instance.chemistry, "chemistry"));
    expect(render).toHaveBeenCalledOnce();
    store.upsertRemote(NS.instance.camera, record(NS.instance.camera, "camera"));
    expect(render).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("rerenders Process Forms recipes only for recipe changes", () => {
    const store = createRecordStore({ repo });
    const render = vi.fn();
    const dispose = renderProcessRecipesOn(store, render);

    store.upsertRemote(NS.instance.chemistry, record(NS.instance.chemistry, "chemistry"));
    expect(render).toHaveBeenCalledOnce();
    store.upsertRemote(NS.catalog.devRecipe, record(NS.catalog.devRecipe, "recipe"));
    expect(render).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("rerenders Scene Editor records only for scene changes", () => {
    const store = createRecordStore({ repo });
    const render = vi.fn();
    const dispose = renderSceneRecordsOn(store, render);

    store.upsertRemote(NS.instance.exposure, record(NS.instance.exposure, "exposure"));
    expect(render).toHaveBeenCalledOnce();
    store.upsertRemote(NS.scene.node, record(NS.scene.node, "node"));
    expect(render).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("rerenders Onboarding only for collections selected by the current step", () => {
    const store = createRecordStore({ repo });
    const render = vi.fn();
    const dispose = renderOnboardingCollectionsOn(store, [NS.instance.camera], render);

    store.upsertRemote(NS.instance.lens, record(NS.instance.lens, "lens"));
    expect(render).toHaveBeenCalledOnce();
    store.upsertRemote(NS.instance.camera, record(NS.instance.camera, "camera"));
    expect(render).toHaveBeenCalledTimes(2);
    dispose();
  });
});
