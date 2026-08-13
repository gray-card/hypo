import { el } from "./element.ts";

export type ThumbnailUrlLoader = () => Promise<string | null | undefined>;

export interface LazyThumbnailOptions {
  className?: string;
  alt?: string;
  rootMargin?: string;
}

type LoadableThumbnail = HTMLDivElement & { _loadThumbnail?: () => Promise<void> };

const observers = new Map<string, IntersectionObserver>();

function observer(rootMargin: string): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  let current = observers.get(rootMargin);
  if (!current) {
    current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          current?.unobserve(entry.target);
          void (entry.target as LoadableThumbnail)._loadThumbnail?.();
        }
      },
      { rootMargin },
    );
    observers.set(rootMargin, current);
  }
  return current;
}

/**
 * Render a thumbnail shell and resolve its URL only when it approaches the
 * viewport. Environments without IntersectionObserver load immediately.
 */
export function lazyThumbnail(
  loadUrl: ThumbnailUrlLoader,
  { className = "thumb", alt = "", rootMargin = "250px" }: LazyThumbnailOptions = {},
): HTMLDivElement {
  const node = el("div", { class: className }) as LoadableThumbnail;
  node._loadThumbnail = async () => {
    try {
      const url = await loadUrl();
      if (url) node.replaceChildren(el("img", { src: url, alt }));
    } catch {
      // A missing remote thumbnail should not make the containing view fail.
    }
  };

  const currentObserver = observer(rootMargin);
  if (currentObserver) currentObserver.observe(node);
  else void node._loadThumbnail();
  return node;
}
