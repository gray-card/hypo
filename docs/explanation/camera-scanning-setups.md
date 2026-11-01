# Modular camera-scanning setups

A **scanning setup** is a reusable assembly of components. A **setup snapshot** is the assembly actually used in one digitization session. The distinction matters: a photographer may replace a light panel or move a camera to another stand without changing what an older session means.

## Research and design constraints

The equipment is not a fixed camera–lens–copy-stand tuple:

| Method                         | Manufacturer evidence                                                                                                                                                                                | Components the model must express                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Lens-mounted holder            | [Nikon ES-2](https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/digitizing-film-using-the-d850-and-es-2-negative-digitizer), [VALOI easy35](https://valoi.co/en-us/products/easy35-v1) | Camera, macro lens, filter-thread adapter, film or slide holder, diffuser, external or integrated light; no stand is required.         |
| Modular copy stand             | [VALOI 360](https://valoi.co/en-us/collections/360), [Negative Supply 120 kit](https://www.negative.supply/shop-all/enthusiast-kit-for-120-film-scanning-mk2)                                        | Camera support, camera and lens, light source, carrier, mask and optional accessories; individual parts may change with film format.   |
| Phone or camera kit            | [Lomography DigitaLIZA Max](https://shop.lomography.com/world/digitaliza-max)                                                                                                                        | Phone or digital camera, holder, film-format mask and backlight; the capture device is not necessarily an interchangeable-lens camera. |
| Large-format or archival stage | [Negative Supply 4×5 carrier](https://www.negative.supply/shop-all/pro-film-carrier-4x5), [Phase One film digitization](https://www.phaseone.com/heritage-solutions/film-digitization/)              | Capture stage, film or glass carrier, camera system, copy stand, illumination, masks and sometimes multiple captures per original.     |

These sources support **open component roles** and **open relationships**, rather than a compulsory list of equipment fields. They do not establish universal compatibility between products. The [FADGI still-image guidelines](https://www.digitizationguidelines.gov/guidelines/digitize-technical.html) also distinguish recording a setup from testing a digitization system: entering a light source or target in Hypo does not assert FADGI conformance.

## Records

`app.graycard.instance.scanSetup` stores a name, components, connections, and settings. Each component has a stable ID and role. It may reference any owned equipment AT-URI, including an existing digital camera, lens or scanner; an unlisted or borrowed item can be named in place. A role can be `capture-camera`, `capture-lens`, `film-carrier`, `light-source`, `camera-support`, `adapter`, `software`, or a user-defined term. A connection names two component IDs and a relation such as `mounted-on`, `illuminates`, or `controls`. Settings are named values, either for a component or the entire setup. This allows, for instance, a filter-thread size, carrier mask, light level, color-temperature setting, or capture software setting without adding a schema field for each manufacturer's accessory.

`app.graycard.process.digitizeSession.scanSetup` points to the reusable setup. `setupSnapshot` copies its assembly into the session at log time and may be adjusted for that session. The older `scanner`, `camera`, and `lens` fields remain independent factual links to the primary devices actually used. They are not deprecated aliases for `scanSetup`: a flatbed scan may have a scanner and no setup, and a one-off camera scan may have camera and lens without a saved setup. Thus no legacy record migration is needed. New sessions with a saved setup write both the reference and snapshot; the Data Quality view flags the rare record that has only the reference.

The setup snapshot is about equipment configuration, not the original or output. Film rolls and resulting photos remain on the digitization session; exposure-to-photo linking remains in the frame linker. A single session can cover several rolls when the assembly is unchanged. If the assembly changes, use a new session or edit the per-session snapshot. This avoids attributing one configuration to captures made after a swap.

## User workflow

1. In Scanning, choose **New setup**. Name it and add any components. Link your existing digital camera and lens where applicable. Name carriers, lights, masks and borrowed accessories that are not in the equipment library. Add relationships and settings as needed.
2. Choose **Log scan session**, select rolls and a saved setup, and review the components used. The camera, lens and scanner selectors remain available for explicit actual-device links. A saved setup's components are copied into the session, so changes to the setup do not rewrite past logs.
3. In a workflow template, a digitize step can default the saved setup, camera, lens, scanner and scan profile. Opening its stage logger uses those defaults. Logging from a roll also uses the next actionable workflow stage's defaults when that roll has one. Completing the session advances the linked stage.
4. Use Data Quality to review broken equipment/connection links, sessions without snapshots, missing process references and completed process stages without logs. Batch rules can preview changes to development, digitization and printing sessions, or to defaults on planned/ready workflow stages. An assignment of a saved setup to an existing digitization session also copies its current assembly as a snapshot.

## Boundaries

The roles and relationships are descriptive, not a manufacturer-certified compatibility graph. Hypo does not infer that a carrier fits a light source or that a macro lens covers a film format. Per-frame exposure settings and stitched/multi-shot capture details are not inferred from a session-wide assembly. Record those differences in session notes or separate sessions until a per-frame digitization-capture record is introduced. This boundary avoids pretending that one session-wide setting describes every tile or bracket.
