interface GearFocusTarget {
  kind: string;
  rkey: string;
}

let pendingTarget: GearFocusTarget | null = null;

export function rememberGearRouteFocus(target: GearFocusTarget): void {
  pendingTarget = target;
}

export function consumeGearRouteFocus(kind: string, rkey: string): (() => void) | undefined {
  if (pendingTarget?.kind !== kind || pendingTarget.rkey !== rkey) return undefined;
  const target = pendingTarget;
  pendingTarget = null;
  return () => {
    let attempts = 0;
    const focus = (): void => {
      const trigger = [...document.querySelectorAll<HTMLElement>("[data-gear-kind][data-record-rkey]")].find(
        (element) => element.dataset.gearKind === target.kind && element.dataset.recordRkey === target.rkey,
      );
      if (trigger) trigger.focus();
      else if (++attempts < 6) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  };
}
