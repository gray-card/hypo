export type DomChild = Node | string | number | boolean | null | undefined;
export type DomChildren = DomChild | readonly DomChild[];

export interface ElementProps {
  class?: string;
  value?: unknown;
  text?: unknown;
  [name: string]: unknown;
}

export function $(selector: string, root: ParentNode = document): Element | null {
  return root.querySelector(selector);
}

export function el<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  props?: ElementProps,
  children?: DomChildren,
): HTMLElementTagNameMap[Tag];
export function el(tag: string, props?: ElementProps, children?: DomChildren): HTMLElement;
export function el(tag: string, props: ElementProps = {}, children: DomChildren = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value as string;
    else if (key === "value") (node as HTMLInputElement).value = value as string;
    else if (key === "text") node.textContent = value as string | null;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value as EventListener);
    else if (typeof value === "boolean") {
      // HTML boolean attributes are controlled by presence, not a "false" value.
      if (key in node) (node as unknown as Record<string, unknown>)[key] = value;
      else if (value) node.setAttribute(key, "");
      else node.removeAttribute(key);
    } else if (value != null) node.setAttribute(key, value as string);
  }
  const childList = Array.isArray(children) ? children : [children];
  for (const child of childList) {
    if (child == null) continue;
    node.append(typeof child === "object" && child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}
