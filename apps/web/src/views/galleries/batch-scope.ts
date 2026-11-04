import type { BatchRule } from "@hypo/domain";

/** Restrict matching without renumbering frame tokens or preview positions. */
export function scopeGalleryRule(
  rule: BatchRule,
  photoUris: readonly string[],
  selected: ReadonlySet<string>,
): BatchRule {
  return {
    ...rule,
    when: {
      operator: "and",
      operands: [
        ...(rule.when ? [rule.when] : []),
        {
          operator: "or",
          operands: photoUris.flatMap((uri, index) =>
            selected.has(uri) ? [{ field: "index", op: "eq", value: index + 1 }] : [],
          ),
        },
      ],
    },
  };
}
