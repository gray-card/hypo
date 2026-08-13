import { describe, expect, it, vi } from "vitest";
import { createLibraryRecordRouteController } from "../apps/web/src/views/library/library-record-route.ts";

const camera = { uri: "at://did/app.graycard.instance.camera/body-1", value: { nickname: "Black body" } };
const roll = { uri: "at://did/app.graycard.instance.filmRoll/roll-1", value: { status: "loaded" } };

function harness(initialStore: any = { instance: { camera: [camera], filmRoll: [roll] } }) {
  let store = initialStore;
  const modal = () => ({ close: vi.fn() });
  const services = {
    getStore: vi.fn(() => store),
    refreshStore: vi.fn(async () => undefined),
    openRoll: vi.fn(() => modal()),
    openGear: vi.fn(() => modal()),
    onRouteModalClosed: vi.fn(),
  };
  return {
    controller: createLibraryRecordRouteController(services),
    services,
    setStore(next: any) {
      store = next;
    },
  };
}

describe("Library record route controller", () => {
  it("targets the requested gear and roll records by URI rkey", async () => {
    const { controller, services } = harness();
    await controller.open({ type: "gear", kind: "camera", rkey: "body-1" });
    expect(services.openGear).toHaveBeenCalledWith("camera", camera, expect.any(Function));

    await controller.open({ type: "roll", rkey: "roll-1" });
    expect(services.openRoll).toHaveBeenCalledWith(roll, expect.any(Function));
    expect(services.openGear.mock.results[0].value.close).toHaveBeenCalledOnce();
  });

  it("refreshes once when a cold target is absent from the current store", async () => {
    const { controller, services, setStore } = harness({ instance: { camera: [] } });
    services.refreshStore.mockImplementation(async () => {
      setStore({ instance: { camera: [camera] } });
    });

    await controller.open({ type: "gear", kind: "camera", rkey: "body-1" });

    expect(services.refreshStore).toHaveBeenCalledOnce();
    expect(services.openGear).toHaveBeenCalledWith("camera", camera, expect.any(Function));
  });

  it("suppresses route navigation for programmatic closes but reports user closes", async () => {
    const { controller, services } = harness();
    const target = { type: "roll", rkey: "roll-1" } as const;
    await controller.open(target);
    const onClose = services.openRoll.mock.calls[0][1];

    controller.close();
    expect(services.onRouteModalClosed).not.toHaveBeenCalled();

    await controller.open(target);
    services.openRoll.mock.calls[1][1]();
    expect(services.onRouteModalClosed).toHaveBeenCalledWith(target);
    onClose();
    expect(services.onRouteModalClosed).toHaveBeenCalledOnce();
  });

  it("does not open a stale target after a newer route cancels its refresh", async () => {
    let finishRefresh!: () => void;
    const { controller, services } = harness({ instance: { camera: [] } });
    services.refreshStore.mockImplementation(() => new Promise<void>((resolve) => (finishRefresh = resolve)));

    const pending = controller.open({ type: "gear", kind: "camera", rkey: "missing" });
    controller.close();
    finishRefresh();
    await pending;

    expect(services.openGear).not.toHaveBeenCalled();
  });
});
