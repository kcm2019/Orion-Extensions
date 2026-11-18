# uBlock for Orion — SPEC

Requested Nov 17, 2026: replicate uBlock Origin on Orion after Orion's uBO
support broke; same filter lists, auto-updating from source.

Picks locked Nov 17, 2026: **Core + B (Logger), C (per-site switches),
E (scriptlets), H (custom lists + import/export), I (fallback cosmetic /
page-world mode if webRequest is dead), J (YouTube fixes).**
Not picked: A picker, D dynamic filtering, F procedural cosmetics,
G annoyances lists.

Hard limit (stated before building): an exact replica is impossible if
Orion's blocking webRequest is the broken layer — any clone uses the same
API. The build therefore ships three layers (webRequest, content,
page-world fallback) plus dashboard Diagnostics that report which layers
are actually alive on the device, and a one-tap probe to settle it.

Status: v1.0.0 built Nov 17, 2026. **v1.1.0 built Nov 17, 2026 — K
anti-detect pack added at Kurt's request:** $redirect/$redirect-rule
engine with bundled stubs (noop, FuckAdBlock, adsbygoogle, Google IMA,
noopvast) served as data: URLs / synthetic fetch-XHR responses, Adblock
Warning Removal List in the registry (10 lists), stealth pass (random
per-page element IDs, closed shadow pill, native toString on wrapped
functions, config via data attribute). Engine, resources, simulated-
runtime and simulated-page-world tests all pass. Build-verified /
simulation-verified only — on-device verdict pending: list download in
the dashboard, probe result, shield pill, YouTube behaviour.
