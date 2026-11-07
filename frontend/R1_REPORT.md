# R1 implementation report

## Phase 1: shell, lenses and routes

The shell has collapsible navigation, request search, four lenses, a live/offline chip and a log link. All eight required routes render, including deep-linked request details. Lists use tables and shared loading, error, empty and status components. Offline request storage is validated and can be reset. Offline approvals never create a decision or log entry.

Verification: 110 tests in 18 files pass; TypeScript and diff checks pass. The original role-page test now checks routed lens homes because Executive replaces the old Steward switcher entry. The technical Steward experience remains available for reuse inside item details in Phase 2. A legacy saved Steward lens maps to Admin.

Screens: home, requests, item, approvals, overview, radar, log, admin. Screenshots for every screen at 320, 375, 768 and 1280 are in frontend/node_modules/.cache/r1/phase1-SCREEN-WIDTH.png. phase1-smoke.json records document widths and browser errors; all passed.

Reference limitation: ~/Studio/lovable-ref does not exist and its named components were not found under Studio. The implementation uses R1's stated warm neutral, deep teal, IBM Plex, 0.5rem radius and panel-shadow direction without copying logic.

Contract assumptions to check: GET /requests returns an array, GET /requests/{id} returns a flat item, origin is user or sample, and requester is text or null. local_only is frontend metadata, never sent as an API field. The contract has no signed-in identity, so lens homes explicitly show accessible items rather than inventing an identity or claiming they are personal records. The request cache stores local drafts only and preserves mock samples unchanged. A simulation or approval always needs the live API. API responses with 4xx errors are never replaced by samples.

Phase 2 will add creation, rechecks, item tabs and the interactive approval pane. Phase 3 will replace the initial Executive and Admin route bodies and extend Radar and Log. Evaluation and voice are deferred to R2.

## Phase 2: requests and approvals

Phase 1 commit: 6dd0a2a. Phase 2 adds creation through POST /requests, navigation to the saved item, filterable and sortable request tables with URL filters, item tabs, a copy link, status-based sticky actions, an approval queue and review pane. Full answers and stored rounds are sent on each clarification recheck. Editing text marks the result outdated and resets old answers/rounds on explicit resubmission. The original Requester component and FlowView source remain unchanged.

Offline creation persists an explicitly local draft. Unknown text is not analysed and has no fabricated evidence, approval or successful gate check. Offline answers never fabricate a cleared clarification loop. Successful work-item reads or creation restore the live environment state. Legacy demo approvals were intentionally removed under the new contract; no tests rely on fabricating a successful approval.

Verification: 117 tests in 20 files pass; TypeScript and diff checks pass. Browser creation and clarification used the same WI work-item id, owner simulation used that id, gates changed from 5/7 to 7/7, and localhost approval produced created, rechecked, remediation_simulated and approved activity entries. The saved decision record showed the actual before_remediation and at_approval snapshots. Rejection and repeat-decision conflict are checked separately. No deployed approval endpoint was used.

Screens: home, requests, item, approvals, overview, radar, log, admin. Screenshots at 320, 375, 768 and 1280: frontend/node_modules/.cache/r1/phase2-SCREEN-WIDTH.png. phase2-smoke.json reports no document overflow or page errors. phase2-flow.json records the local lifecycle verification.

Contract assumptions: POST /requests is open, including rechecks, and returns request_id, status and result. Work-item ids are used explicitly for approve and remediate, while legacy ad hoc recommendation helpers keep their original intent fallback. A stored simulation can be displayed on return, but owner/date inputs must be checked again before approval because the simulation response does not expose the submitted review date. Creation dates are filtered by the recorded ISO calendar day. GET /requests without a status is the open list, capped at 200; completed items are loaded through their status filter. Every control that disables approval has a visible reason. 401 errors direct users to Admin settings without exposing access-code contents.

The initial smoke command used the repository working directory for an extra ignored screenshot cache; the reported screenshots are anchored to the frontend cache. No source files outside frontend were changed.
