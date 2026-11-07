# Finish implementation and verification

Branch: redesign. Work is limited to frontend. No pushes, deployments, or cluster commands. FlowView and both immutable mock files are preserved.

## Part 0: merge and baseline

The working tree was clean. `git merge reuse-gate-build` returned Already up to date; the requested merge is already committed as ce78605. No conflicts occurred and no redundant merge was created.

Baseline: 131 tests in 24 files passed, `npx tsc --noEmit` passed, and `npm run build` passed. This part's commit records the verified baseline.

## Part 1: audit resolution

Fixed a real sticky-action focus occlusion. The reproducible browser assertions passed 22 checks covering all original flagged views and widths, with exact focus order and visibility checks, roving tabs, and annotated clipped bounding boxes. Every one of the 23 defect findings and 144 informational measurement records is indexed in R1_AUDIT_RESOLUTION.md. Concrete traces are committed in verification/audit-evidence.json. All 131 unit tests pass. No certified gate is claimed.

## Part 2: evaluation

Added /evaluation and links from Overview and Admin. Metrics retain their API method, basis, caveat, generated time and estate snapshot. Shares use percentages; counts use numbers; null, nonnumeric, non-finite and n=0 values show Not measured with the reason. Measured zero remains zero. Generation and Retriever follow the requested RAG grouping. Explanations name models only when supplied in method.

Validation: 141 tests in 25 files, type check, and real Enter-key expansion/collapse with an offline banner at 320, 375, 768 and 1280px. No horizontal document overflow. Browser evidence: /tmp/reuse-gate-visual/finish/evaluation/evidence.json. A latency-dependent optional spec request in audit-fixes.test.tsx was reproduced and isolated with a mock; the ten-run stability check follows in Part 4.

## Part 3: voice input

Added optional push-to-talk next to new-request text. It is hidden without MediaRecorder or microphone capture support. Recording uses the recorder MIME type, stops at 30 seconds, limits audio to a conservative 1,000,000 bytes, releases tracks, and sends raw audio to POST /transcribe. A 45-second client timeout prevents an indefinite wait. Transcripts remain in component memory for editable confirmation and Discard; Use this text changes only the request field. Creation remains a separate explicit action. No audio or unconfirmed transcript is written to storage, URLs or logs. Navigating away aborts transcription and releases the microphone.

All specified transcription codes and microphone denial end with please type instead. Optional controls use native buttons, visible focus and live recording/transcribing announcements. Validation: 160 tests in 26 files, including 19 fake-recorder/fake-fetch checks for raw transport, timer, permission denial, size limits, confirmation, discard, unavailable APIs, cleanup and error mapping. Type check passes. Browser voice-state screenshots follow in Part 4; no physical microphone or external transcription provider is used for these tests.

## Parts index

1. Audit findings and concrete per-finding resolution evidence.
2. Evaluation page.
3. Voice push-to-talk.
4. Repeated suite, polish and screenshots.
5. Final verification and browser flow.

## Part 4: stability and product polish

Ten consecutive complete suites passed: 160 tests each, 1,600 passing test executions. The reproducible command is `node frontend/verification/repeat-suite.mjs`; logs and results are under /tmp/reuse-gate-visual/finish/stability-release/. Earlier attempts are retained, including failures; they are not presented as passing evidence.

Three causes were distinguished: the original approval regression used a real optional spec-preview request; the new transcript focus test asserted before its React effect; and unbounded Vitest worker contention caused a five-second timeout during concurrent browser captures. The first request is mocked in its unit test, focus is awaited without weakening the assertion, and Vitest is capped at four workers. The configuration also uses import.meta.url instead of __dirname. One Executive assertion was updated for the deliberate plain-language copy change, not as a flake fix.

Polish: the Requester sentence and saved request title scale from 22px to 28px with semibold weight; Requester targets remain at least 64px. Added explicit empty evidence and active-owner states, a restrained checkbox colour, a visible approver in the saved record, readable non-wrapping status badges in bounded mobile tables, and simpler Executive wording. An experimental skip link was removed after the runtime audit found focus-placement problems. The new-request form waits for hydration before accepting input, preventing fast typing from being lost. No API, gate or offline-approval contract was relaxed.

Screenshots: 84 page, tab, lens-home and voice-state captures plus four saved-record captures, 88 total. Every capture is indexed in FINISH_SCREENSHOTS.md. No document overflow was found at 320, 375, 768 or 1280px. Voice browser checks assert native keyboard confirmation, no automatic request submission, unchanged storage and safe unavailable-provider recovery.

The local browser test uses a clearly disclosed, browser-intercepted fixture API for create, full clarification, simulated SM-065 ownership, demo-labelled approval, the stored before/after record and Evaluation. It never submits writes to a server. The application's production offline mode still refuses approvals and remediation. The fixture records 5/7 before and 7/7 after and asserts full rounds and checked remediations are sent. It is frontend integration evidence, not proof of backend rule correctness.

### Remaining weaknesses by lens and persona

The final original-finding regression check again passed all 22 browser checks after polish. Its complete traces are in verification/audit-evidence-final.json. All quick frontend issues found in this pass were addressed. The remaining limits need backend capabilities, identity, integration work or user research; none is hidden behind a success claim.

| Lens or persona | Three remaining weaknesses |
|---|---|
| Requester / analyst | No signed-in identity, so the lens shows accessible requests rather than a true personal inbox. Offline drafts stay on this device and cannot be independently analysed. There are no notifications when a request changes or needs another answer. |
| Approver | Owner role and market fit are advisory because the gate checks active status only. A saved simulation must be checked again before approval because its submitted review date is not returned. There is no conflict-of-interest or approval-delegation policy in the supplied API. |
| Executive | Proposed routes and modelled counts are not realised savings. Request-based measures cover at most 200 returned items, not an organisation-wide history. Owner certification is absent, so the UI can only report asset certification and explain that limit. |
| Admin | Provider fields can remain unknown because health does not consistently expose them. There is no health history or alerting endpoint. Session access supports a shared code, not user lifecycle, role grants or token rotation. |
| Developer (Admin lens) | No cross-service trace identifier is supplied for correlation. No API schema/version negotiation is supplied. Asset and request relationships are limited to verified targets and named searches, not a complete lineage/dependency API. |

### Backend assumptions for Claude Code to check

- Existing R1 request, approval, remediation and record assumptions remain in R1_REPORT.md; the frontend preserves their wire shapes.
- GET /evaluation supplies generated_at, estate_snapshot and ordered group objects with metric id, name, value, unit, n, method, basis and caveat. The frontend orders known groups and retains unknown ones after them. Empty groups remain visible. Shares are fractions from 0 to 1; other numeric units are counts or displayed numbers. Null, nonnumeric/non-finite values and n=0 are not measured; measured numeric zero with n>0 remains zero.
- Model attribution is read from the method text, never hard-coded as the current deployment provider. Methods and all caveats remain available in keyboard-operable details.
- POST /transcribe is open, accepts the raw blob and the recorder's exact Content-Type including any codec parameter, and returns nonempty text plus language. It does not accept JSON or require X-Access-Code. Check that the server normalises MIME parameters. The client rejects above 1,000,000 bytes, conservatively within a one-MB limit.
- Transcription errors provide a code from the supplied contract. Unknown codes and malformed responses use a generic safe typing recovery. A 45-second client deadline may produce provider_timeout if the network never returns.
- Voice data is transient in memory. Only after Use this text and a separate Create request action does the confirmed request text enter the ordinary saved-request contract.
- The browser fixture's approval response is explicitly demo-labelled and synthetic. It proves client sequencing and rendering only; it does not certify the deployed backend, production authentication, or any BI-tool change.

### Limits and work not performed

No physical microphone, external speech provider, protected production approval or deployment was used. Real-world transcription quality, privacy at the provider and role comprehension need separate verification. No representative-user study or certified design gate is claimed. The original unavailable visual reference remains unavailable. No dependencies were installed. FlowView, backend, data and deploy files are untouched in these Finish commits; the merge was already present.
