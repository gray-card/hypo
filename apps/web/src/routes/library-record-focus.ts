interface GearFocusTarget {
  kind: string;
  rkey: string;
}

let pendingTarget: GearFocusTarget | null = null;
let pendingRestoreTarget: GearFocusTarget | null = null;

function findTrigger(target: GearFocusTarget): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-gear-kind][data-record-rkey]")].find(
    (element) => element.dataset.gearKind === target.kind && element.dataset.recordRkey === target.rkey,
  );
}

export function rememberGearRouteFocus(target: GearFocusTarget): void {
  pendingTarget = target;
}

export function consumeGearRouteFocus(kind: string, rkey: string): (() => void) | undefined {
  if (pendingTarget?.kind !== kind || pendingTarget.rkey !== rkey) return undefined;
  const target = pendingTarget;
  pendingTarget = null;
  return () => {
    // Closing the route modal starts history navigation back to Library. Focus the
    // current trigger immediately for fast navigations, but retain the target so
    // Library can focus the replacement node after its remote refresh rerenders.
    pendingRestoreTarget = target;
    let attempts = 0;
    const focus = (): void => {
      const trigger = findTrigger(target);
      if (trigger) trigger.focus();
      else if (++attempts < 6) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  };
}

export function restorePendingGearRouteFocus(): void {
  if (!pendingRestoreTarget) return;
  const target = pendingRestoreTarget;
  pendingRestoreTarget = null;
  findTrigger(target)?.focus();
}
