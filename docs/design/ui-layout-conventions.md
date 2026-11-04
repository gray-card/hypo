# UI layout conventions

Hypo uses one page frame across Library, Rolls, Sessions, and Galleries. Keep the
outer frame stable when changing views; put task-specific arrangements inside it.

## Shared styles

- Use `--page-width`, `--page-gutter`, and `--page-top-space` for page geometry.
  The default frame is 880px wide. Mobile and compact density adjust shared tokens.
- Use `.view-head` with an `h2` or `.view-title`, followed by `.view-sub.muted.small`
  for a page heading and explanation. Keep back navigation above record headings.
- Use `.card` for panels. Its padding follows `--panel-padding`, including compact
  density. Use `--section-gap` between major sections and the `--space-*` scale
  within them.
- Use `.collapse-card` for a collapsible settings card and `.form-disclosure` for
  secondary fields inside an editor. Both use native `details` and `summary`.
  Preserve keyboard activation, visible focus, and the browser's expanded state.
- Use the shared button, field, status, and theme styles. Fixed save bars align
  their contents with the page's content edges. Dialogs retain their shared modal
  action footer.
- Keep section toolbars at least 16px from the content below. Inside dialogs,
  separate filters from results by at least 12px. Label every filter and align
  controls on the same row; shared search margins must not offset one field.
- Keep checkboxes and radios at their intrinsic width, beside their labels.
  Place status messages above multi-column forms so they cannot displace one
  column. Group related stage timing fields on one row, stacking them on phones.

## Gallery arrangements

The desktop gallery keeps the grid and inspector inside the standard page frame.
Below 900px, the inspector occupies the available content width. Photo cards
reserve two caption lines and place optional coverage badges after the EXIF
readout, so missing alt text or a wrapped caption cannot move the readout. Frame
numbers appear once. Saved edits refresh the caption, readout, and coverage badges.

Use theme tokens for photo-card and readout surfaces; a light theme must not retain
a dark surface with light-theme text colors. Keep photographic thumbnails distinct
from the surrounding interface.

## Bars and quantities

Choose the representation from the meaning of the value:

- **Quantity meters** show a bounded amount remaining, such as chemistry volume.
  Fill always means remaining, from empty to full. Show the amount, unit, and
  container total. Equal track widths encode a fraction of each container, not
  equal absolute volumes. Use `role="meter"` with values in the displayed unit.
- **Usage counts** show observations against a recommended limit, such as rolls
  processed. Show the used count and recommendation as text, with explicit
  reached/exceeded states. Do not substitute a count bar for a missing volume
  meter or hide one measurement when the other is available. Volume does not
  establish chemical strength or remaining processing capacity.
- **Progress bars** describe task completion, such as workflow steps or uploads.
  Fill means completed work. Use `role="progressbar"`, name the task, and expose
  completed and total units. Keep them within their task, separate from inventory.
- **Comparison charts** compare one measure and unit across categories, such as
  film-roll counts by status. All rows share a zero baseline, maximum, and track
  width; keep the numeric count visible. Do not mix these with quantity meters.

Track geometry belongs to the containing layout, never the length of its label.
Chemistry rows share a fixed grid column on desktop and the full content width on
phones. Labels wrap without changing the track. Use theme tokens for fill colors;
do not imply chemical health through a green volume bar. Unknown values are
labelled as unrecorded, not represented as zero. Omit meters with missing or
nonpositive totals. Clamp visual fill to its track while preserving recorded
quantities in visible and accessible text.

Chemistry names remain product names. In status cards and resource lists, show
roles as separate, neutral text chips; multi-role products get one chip per role.
Do not use category colors as health or safety signals. Plain-text selectors keep
category labels for disambiguation without appending the same roles again.

## Verification

`tests/e2e/gallery-editing.spec.js` compares page widths, heading typography,
disclosure typography, and save-bar edges across screens in both themes. It checks
comfortable and compact density at phone, tablet, and desktop widths, and compares
card geometry with short, missing, and long captions and populated EXIF. Visual
snapshots complement these checks; update them only after reviewing the rendered
change.

`tests/e2e/responsive-library.spec.js` captures the Library overview, roll ledger,
Sessions list and detail, and camera, chemistry, batch-rule, roll, and development
forms in both themes on desktop Chromium, mobile Chromium, and mobile WebKit.
Dialog captures include their lower sections and action footers. Geometry checks
cover aligned form columns, checkbox labels, filter-to-list spacing, stage timing
fields, and horizontal overflow. Review the attached screenshots as well as the
assertions; a passing overflow check alone does not establish good spacing.
