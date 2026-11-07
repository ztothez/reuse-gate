# R1 implementation report

## Phase 1: shell, lenses and routes

The shell has collapsible navigation, request search, four lenses, a live/offline chip and a log link. All eight required routes render, including deep-linked request details. Lists use tables and shared loading, error, empty and status components. Offline request storage is validated and can be reset. Offline approvals never create a decision or log entry.

Verification: 110 tests in 18 files pass; TypeScript and diff checks pass. The original role-page test now checks routed lens homes because Executive replaces the old Steward switcher entry. The technical Steward experience remains available for reuse inside item details in Phase 2. A legacy saved Steward lens maps to Admin.

Screens: home, requests, item, approvals, overview, radar, log, admin. Screenshots for every screen at 320, 375, 768 and 1280 are in frontend/node_modules/.cache/r1/phase1-SCREEN-WIDTH.png. phase1-smoke.json records document widths and browser errors; all passed.

Reference limitation: ~/Studio/lovable-ref does not exist and its named components were not found under Studio. The implementation uses R1's stated warm neutral, deep teal, IBM Plex, 0.5rem radius and panel-shadow direction without copying logic.

Contract assumptions to check: GET /requests returns an array, GET /requests/{id} returns a flat item, origin is user or sample, and requester is text or null. local_only is frontend metadata, never sent as an API field. The contract has no signed-in identity, so lens homes explicitly show accessible items rather than inventing an identity or claiming they are personal records. The request cache stores local drafts only and preserves mock samples unchanged. A simulation or approval always needs the live API. API responses with 4xx errors are never replaced by samples.

Phase 2 will add creation, rechecks, item tabs and the interactive approval pane. Phase 3 will replace the initial Executive and Admin route bodies and extend Radar and Log. Evaluation and voice are deferred to R2.
