---
title: Write and apply batch rules
description: Build, preview, and apply gallery or process-record batch rules.
---

# Write and apply batch rules

Open a gallery's **Batch edit** panel, or use **Library → Rules → Create batch rule**. Choose a scope: gallery, development sessions, digitization sessions, printing sessions, or planned workflow stages. A rule contains a condition under `when` and one or more typed `actions`. Saving a rule does not apply it.

## Build the condition

Add one or more field comparisons. Gallery rules offer EXIF fields, alt text, gallery metadata, capture references, and the one-based photo `index`. Process rules read `record.fieldName`, such as `record.method` or `record.processDefaults.scanSetup`. Combine rows with **Match ALL** (`and`), **Match ANY** (`or`), or **Match NOT** (`not`, one condition). The advanced JSON editor retains nested boolean groups and actions that the guided rows cannot express; switching on the advanced editor makes its JSON the source of the saved rule.

Comparison operators include emptiness and existence tests, equality, substring and prefix/suffix tests, regular-expression matching, numeric comparisons, and membership. Values read through the UI are strings; numeric operators parse them as numbers.

For instance, fill only empty alt text with:

```json
{
  "when": { "field": "alt", "op": "empty" },
  "actions": [
    {
      "op": "setAlt",
      "value": "{{gallery.title}} #{{index}}",
      "mode": "ifEmpty"
    }
  ]
}
```

Templates may read `{{gallery.title}}`, `{{index}}`, and other supported field paths.

## Choose actions

Gallery rules persist:

- `setAlt`;
- `setExif`;
- `projectCaptureToExif`;
- `associateCamera`; and
- `associateLens`; and
- `setGalleryDescription` (once per gallery, after matching photos agree on the result).

Use `fill` or `ifEmpty` when existing observations should win. Use `overwrite` only after reviewing every match.

For process and workflow scopes, use `setField` or `clearField`. The field picker suggests supported fields for each scope; preview rejects unsupported fields or actions rather than silently ignoring them. A digitization-session rule can assign a saved `scanSetup`; a development-session rule can assign a `developmentPlan`; and a print-session rule can assign an `exposurePlan`. Hypo copies the selected setup or plan into each matched session's historical snapshot. Workflow-stage rules edit defaults only on **planned** or **ready** stages. They do not retroactively rewrite completed work.

For process rules, `fill` and `ifEmpty` keep an existing value; `overwrite` replaces it. `clearField` removes an optional field. Created dates, session subjects, workflow status and other lifecycle fields are intentionally not batch-editable. To change them, use the relevant record editor or workflow action.

## Preview before applying

For gallery rules, select **Preview** in the gallery and inspect the matching photo numbers and changed fields. Then select **Apply** and confirm. For process rules, use **Preview** beside the saved rule in Library → Rules. The count and a sample of changed records appear there; **Apply** stays disabled until a successful preview and asks for confirmation. Preview does not write records.

Give the rule a name and select **Save rule**. This stores an `app.graycard.rule.batch` record. The lexicon also names some actions that remain unsupported in a given scope; preview and save now report that mismatch rather than dropping the action. Regex `pattern` and `flags` can be specified in advanced JSON; the guided value box supplies the default pattern.
