# R1 audit finding resolution

The original audit is preserved in R1_AUDIT.json. Every finding is indexed below in its original array order. Informational measurement records do not assert defects; they are retained in the second table. No certified gate is claimed.

## Reproduction and concrete evidence

Run `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node frontend/verification/audit-resolution.mjs` with the existing local app on port 8084. This uses an existing browser package, not a new application dependency. VERIFY_URL and EVIDENCE_DIR can select another local preview and artifact directory. The populated review fixture is the undecided local request WI-31CF5342; no approval or remediation is submitted by this check.

[Reproducible assertions](verification/audit-resolution.mjs) and [complete focus traces and bounding boxes](verification/audit-evidence.json) are committed. Each focus trace asserts the exact DOM tab order, excludes disabled/hidden/negative-tabindex controls, permits only native date subfield repeats, and asserts the focused control has a painted, unoccluded intersection with the viewport. Item tabs are also tested with ArrowRight. The 22 browser checks all passed.

A real defect was found: at tablet width the bottom sticky request action could cover the focused Overview tab. CSS scroll padding and focus scroll margins now reserve space for the action bar. The failing screenshot is /tmp/reuse-gate-visual/finish/audit-resolution/failure-item-tablet.png; the passing trace and screenshot are item-tablet.

Radar screenshots overlay the actual painted bounds after intersection with every clipping ancestor. Independent controls are compared; ancestor scroll regions and their own links are not independent hit targets. All independent intersections are at most four pixels in each direction, with zero reported collisions at 768 and 1280px. Screenshots: /tmp/reuse-gate-visual/finish/audit-resolution/radar-bounds-tablet.png and radar-bounds-desktop.png.

## Defect findings, one resolution per entry

| Original finding | View | Verdict | Concrete evidence |
|---|---|---|---|
| runtime.findings[19]: ZTDE-RUNTIME-014, input | requests, phone320 | False positive: native date subfields or non-sequential inactive/hidden controls | 29 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: requests-phone320; screenshot requests-phone320.png. |
| runtime.findings[24]: ZTDE-RUNTIME-014, input | requests, phone375 | False positive: native date subfields or non-sequential inactive/hidden controls | 29 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: requests-phone375; screenshot requests-phone375.png. |
| runtime.findings[29]: ZTDE-RUNTIME-014, input | requests, tablet | False positive: native date subfields or non-sequential inactive/hidden controls | 37 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: requests-tablet; screenshot requests-tablet.png. |
| runtime.findings[34]: ZTDE-RUNTIME-014, input | requests, desktop | False positive: native date subfields or non-sequential inactive/hidden controls | 37 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: requests-desktop; screenshot requests-desktop.png. |
| runtime.findings[39]: ZTDE-RUNTIME-014, button | item, phone320 | Related focus occlusion fixed; repeated-focus defect disproved after fix | 8 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: item-phone320; screenshot item-phone320.png. |
| runtime.findings[44]: ZTDE-RUNTIME-014, #global-search | item, phone375 | Related focus occlusion fixed; repeated-focus defect disproved after fix | 13 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: item-phone375; screenshot item-phone375.png. |
| runtime.findings[49]: ZTDE-RUNTIME-014, button | item, tablet | Related focus occlusion fixed; repeated-focus defect disproved after fix | 21 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: item-tablet; screenshot item-tablet.png. |
| runtime.findings[54]: ZTDE-RUNTIME-014, button | item, desktop | Related focus occlusion fixed; repeated-focus defect disproved after fix | 21 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: item-desktop; screenshot item-desktop.png. |
| runtime.findings[59]: ZTDE-RUNTIME-014, #review | approvals, phone320 | False positive: native date subfields or non-sequential inactive/hidden controls | 19 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: approvals-phone320; screenshot approvals-phone320.png. |
| runtime.findings[64]: ZTDE-RUNTIME-014, #review | approvals, phone375 | False positive: native date subfields or non-sequential inactive/hidden controls | 19 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: approvals-phone375; screenshot approvals-phone375.png. |
| runtime.findings[69]: ZTDE-RUNTIME-014, #review | approvals, tablet | False positive: native date subfields or non-sequential inactive/hidden controls | 27 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: approvals-tablet; screenshot approvals-tablet.png. |
| runtime.findings[74]: ZTDE-RUNTIME-014, #review | approvals, desktop | False positive: native date subfields or non-sequential inactive/hidden controls | 27 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: approvals-desktop; screenshot approvals-desktop.png. |
| runtime.findings[79]: ZTDE-RUNTIME-014, #what-if-review | overview, phone320 | False positive: native date subfields or non-sequential inactive/hidden controls | 23 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: overview-phone320; screenshot overview-phone320.png. |
| runtime.findings[84]: ZTDE-RUNTIME-014, #what-if-review | overview, phone375 | False positive: native date subfields or non-sequential inactive/hidden controls | 23 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: overview-phone375; screenshot overview-phone375.png. |
| runtime.findings[89]: ZTDE-RUNTIME-014, #what-if-review | overview, tablet | False positive: native date subfields or non-sequential inactive/hidden controls | 31 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: overview-tablet; screenshot overview-tablet.png. |
| runtime.findings[94]: ZTDE-RUNTIME-014, #what-if-review | overview, desktop | False positive: native date subfields or non-sequential inactive/hidden controls | 31 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: overview-desktop; screenshot overview-desktop.png. |
| runtime.findings[104]: ZTDE-RUNTIME-010, div.min-w-0 > main.min-w-0 > section.mb-8 > div.table-region | radar, tablet | False positive: unclipped geometry or ancestor/child hit targets | verification/audit-evidence.json: radar-tablet, zero independent painted collisions; radar-bounds-tablet.png. |
| runtime.findings[109]: ZTDE-RUNTIME-010, div.min-w-0 > main.min-w-0 > section.mb-8 > div.table-region | radar, desktop | False positive: unclipped geometry or ancestor/child hit targets | verification/audit-evidence.json: radar-desktop, zero independent painted collisions; radar-bounds-desktop.png. |
| runtime.findings[110]: ZTDE-RUNTIME-010, tbody > tr > td > a.request-link | radar, desktop | False positive: unclipped geometry or ancestor/child hit targets | verification/audit-evidence.json: radar-desktop, zero independent painted collisions; radar-bounds-desktop.png. |
| populated_review.findings[3]: ZTDE-RUNTIME-014, #review | populated_review, phone320 | False positive: native date subfields or non-sequential inactive/hidden controls | 19 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: populated_review-phone320; screenshot populated_review-phone320.png. |
| populated_review.findings[8]: ZTDE-RUNTIME-014, #review | populated_review, phone375 | False positive: native date subfields or non-sequential inactive/hidden controls | 19 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: populated_review-phone375; screenshot populated_review-phone375.png. |
| populated_review.findings[13]: ZTDE-RUNTIME-014, #review | populated_review, tablet | False positive: native date subfields or non-sequential inactive/hidden controls | 27 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: populated_review-tablet; screenshot populated_review-tablet.png. |
| populated_review.findings[18]: ZTDE-RUNTIME-014, #review | populated_review, desktop | False positive: native date subfields or non-sequential inactive/hidden controls | 27 controls in exact order; every focus visible and unoccluded. verification/audit-evidence.json: populated_review-desktop; screenshot populated_review-desktop.png. |

All screenshot filenames in the table are under /tmp/reuse-gate-visual/finish/audit-resolution/. The committed JSON contains measured coordinates and complete named focus traces, not just pass flags.

## Informational coverage records, one entry per original finding

| Original finding | Check | View | Verdict |
|---|---|---|---|
| runtime.findings[0] | ZTDE-RUNTIME-011-MEASURED | base, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[1] | ZTDE-RUNTIME-012-MEASURED | base, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[2] | ZTDE-RUNTIME-006-MEASURED | base, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[3] | ZTDE-RUNTIME-016-MEASURED | base, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[4] | ZTDE-RUNTIME-011-MEASURED | base, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[5] | ZTDE-RUNTIME-012-MEASURED | base, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[6] | ZTDE-RUNTIME-006-MEASURED | base, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[7] | ZTDE-RUNTIME-016-MEASURED | base, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[8] | ZTDE-RUNTIME-011-MEASURED | base, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[9] | ZTDE-RUNTIME-012-MEASURED | base, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[10] | ZTDE-RUNTIME-006-MEASURED | base, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[11] | ZTDE-RUNTIME-016-MEASURED | base, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[12] | ZTDE-RUNTIME-011-MEASURED | base, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[13] | ZTDE-RUNTIME-012-MEASURED | base, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[14] | ZTDE-RUNTIME-006-MEASURED | base, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[15] | ZTDE-RUNTIME-016-MEASURED | base, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[16] | ZTDE-RUNTIME-011-MEASURED | requests, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[17] | ZTDE-RUNTIME-012-MEASURED | requests, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[18] | ZTDE-RUNTIME-006-MEASURED | requests, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[20] | ZTDE-RUNTIME-016-MEASURED | requests, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[21] | ZTDE-RUNTIME-011-MEASURED | requests, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[22] | ZTDE-RUNTIME-012-MEASURED | requests, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[23] | ZTDE-RUNTIME-006-MEASURED | requests, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[25] | ZTDE-RUNTIME-016-MEASURED | requests, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[26] | ZTDE-RUNTIME-011-MEASURED | requests, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[27] | ZTDE-RUNTIME-012-MEASURED | requests, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[28] | ZTDE-RUNTIME-006-MEASURED | requests, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[30] | ZTDE-RUNTIME-016-MEASURED | requests, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[31] | ZTDE-RUNTIME-011-MEASURED | requests, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[32] | ZTDE-RUNTIME-012-MEASURED | requests, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[33] | ZTDE-RUNTIME-006-MEASURED | requests, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[35] | ZTDE-RUNTIME-016-MEASURED | requests, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[36] | ZTDE-RUNTIME-011-MEASURED | item, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[37] | ZTDE-RUNTIME-012-MEASURED | item, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[38] | ZTDE-RUNTIME-006-MEASURED | item, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[40] | ZTDE-RUNTIME-016-MEASURED | item, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[41] | ZTDE-RUNTIME-011-MEASURED | item, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[42] | ZTDE-RUNTIME-012-MEASURED | item, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[43] | ZTDE-RUNTIME-006-MEASURED | item, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[45] | ZTDE-RUNTIME-016-MEASURED | item, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[46] | ZTDE-RUNTIME-011-MEASURED | item, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[47] | ZTDE-RUNTIME-012-MEASURED | item, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[48] | ZTDE-RUNTIME-006-MEASURED | item, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[50] | ZTDE-RUNTIME-016-MEASURED | item, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[51] | ZTDE-RUNTIME-011-MEASURED | item, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[52] | ZTDE-RUNTIME-012-MEASURED | item, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[53] | ZTDE-RUNTIME-006-MEASURED | item, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[55] | ZTDE-RUNTIME-016-MEASURED | item, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[56] | ZTDE-RUNTIME-011-MEASURED | approvals, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[57] | ZTDE-RUNTIME-012-MEASURED | approvals, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[58] | ZTDE-RUNTIME-006-MEASURED | approvals, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[60] | ZTDE-RUNTIME-016-MEASURED | approvals, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[61] | ZTDE-RUNTIME-011-MEASURED | approvals, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[62] | ZTDE-RUNTIME-012-MEASURED | approvals, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[63] | ZTDE-RUNTIME-006-MEASURED | approvals, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[65] | ZTDE-RUNTIME-016-MEASURED | approvals, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[66] | ZTDE-RUNTIME-011-MEASURED | approvals, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[67] | ZTDE-RUNTIME-012-MEASURED | approvals, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[68] | ZTDE-RUNTIME-006-MEASURED | approvals, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[70] | ZTDE-RUNTIME-016-MEASURED | approvals, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[71] | ZTDE-RUNTIME-011-MEASURED | approvals, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[72] | ZTDE-RUNTIME-012-MEASURED | approvals, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[73] | ZTDE-RUNTIME-006-MEASURED | approvals, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[75] | ZTDE-RUNTIME-016-MEASURED | approvals, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[76] | ZTDE-RUNTIME-011-MEASURED | overview, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[77] | ZTDE-RUNTIME-012-MEASURED | overview, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[78] | ZTDE-RUNTIME-006-MEASURED | overview, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[80] | ZTDE-RUNTIME-016-MEASURED | overview, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[81] | ZTDE-RUNTIME-011-MEASURED | overview, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[82] | ZTDE-RUNTIME-012-MEASURED | overview, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[83] | ZTDE-RUNTIME-006-MEASURED | overview, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[85] | ZTDE-RUNTIME-016-MEASURED | overview, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[86] | ZTDE-RUNTIME-011-MEASURED | overview, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[87] | ZTDE-RUNTIME-012-MEASURED | overview, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[88] | ZTDE-RUNTIME-006-MEASURED | overview, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[90] | ZTDE-RUNTIME-016-MEASURED | overview, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[91] | ZTDE-RUNTIME-011-MEASURED | overview, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[92] | ZTDE-RUNTIME-012-MEASURED | overview, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[93] | ZTDE-RUNTIME-006-MEASURED | overview, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[95] | ZTDE-RUNTIME-016-MEASURED | overview, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[96] | ZTDE-RUNTIME-011-MEASURED | radar, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[97] | ZTDE-RUNTIME-012-MEASURED | radar, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[98] | ZTDE-RUNTIME-006-MEASURED | radar, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[99] | ZTDE-RUNTIME-016-MEASURED | radar, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[100] | ZTDE-RUNTIME-011-MEASURED | radar, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[101] | ZTDE-RUNTIME-012-MEASURED | radar, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[102] | ZTDE-RUNTIME-006-MEASURED | radar, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[103] | ZTDE-RUNTIME-016-MEASURED | radar, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[105] | ZTDE-RUNTIME-011-MEASURED | radar, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[106] | ZTDE-RUNTIME-012-MEASURED | radar, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[107] | ZTDE-RUNTIME-006-MEASURED | radar, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[108] | ZTDE-RUNTIME-016-MEASURED | radar, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[111] | ZTDE-RUNTIME-011-MEASURED | radar, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[112] | ZTDE-RUNTIME-012-MEASURED | radar, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[113] | ZTDE-RUNTIME-006-MEASURED | radar, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[114] | ZTDE-RUNTIME-016-MEASURED | radar, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[115] | ZTDE-RUNTIME-011-MEASURED | log, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[116] | ZTDE-RUNTIME-012-MEASURED | log, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[117] | ZTDE-RUNTIME-006-MEASURED | log, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[118] | ZTDE-RUNTIME-016-MEASURED | log, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[119] | ZTDE-RUNTIME-011-MEASURED | log, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[120] | ZTDE-RUNTIME-012-MEASURED | log, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[121] | ZTDE-RUNTIME-006-MEASURED | log, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[122] | ZTDE-RUNTIME-016-MEASURED | log, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[123] | ZTDE-RUNTIME-011-MEASURED | log, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[124] | ZTDE-RUNTIME-012-MEASURED | log, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[125] | ZTDE-RUNTIME-006-MEASURED | log, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[126] | ZTDE-RUNTIME-016-MEASURED | log, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[127] | ZTDE-RUNTIME-011-MEASURED | log, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[128] | ZTDE-RUNTIME-012-MEASURED | log, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[129] | ZTDE-RUNTIME-006-MEASURED | log, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[130] | ZTDE-RUNTIME-016-MEASURED | log, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[131] | ZTDE-RUNTIME-011-MEASURED | admin, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[132] | ZTDE-RUNTIME-012-MEASURED | admin, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[133] | ZTDE-RUNTIME-006-MEASURED | admin, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[134] | ZTDE-RUNTIME-016-MEASURED | admin, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[135] | ZTDE-RUNTIME-011-MEASURED | admin, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[136] | ZTDE-RUNTIME-012-MEASURED | admin, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[137] | ZTDE-RUNTIME-006-MEASURED | admin, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[138] | ZTDE-RUNTIME-016-MEASURED | admin, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[139] | ZTDE-RUNTIME-011-MEASURED | admin, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[140] | ZTDE-RUNTIME-012-MEASURED | admin, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[141] | ZTDE-RUNTIME-006-MEASURED | admin, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[142] | ZTDE-RUNTIME-016-MEASURED | admin, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[143] | ZTDE-RUNTIME-011-MEASURED | admin, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[144] | ZTDE-RUNTIME-012-MEASURED | admin, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[145] | ZTDE-RUNTIME-006-MEASURED | admin, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| runtime.findings[146] | ZTDE-RUNTIME-016-MEASURED | admin, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[0] | ZTDE-RUNTIME-011-MEASURED | populated_review, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[1] | ZTDE-RUNTIME-012-MEASURED | populated_review, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[2] | ZTDE-RUNTIME-006-MEASURED | populated_review, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[4] | ZTDE-RUNTIME-016-MEASURED | populated_review, phone320 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[5] | ZTDE-RUNTIME-011-MEASURED | populated_review, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[6] | ZTDE-RUNTIME-012-MEASURED | populated_review, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[7] | ZTDE-RUNTIME-006-MEASURED | populated_review, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[9] | ZTDE-RUNTIME-016-MEASURED | populated_review, phone375 | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[10] | ZTDE-RUNTIME-011-MEASURED | populated_review, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[11] | ZTDE-RUNTIME-012-MEASURED | populated_review, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[12] | ZTDE-RUNTIME-006-MEASURED | populated_review, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[14] | ZTDE-RUNTIME-016-MEASURED | populated_review, tablet | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[15] | ZTDE-RUNTIME-011-MEASURED | populated_review, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[16] | ZTDE-RUNTIME-012-MEASURED | populated_review, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[17] | ZTDE-RUNTIME-006-MEASURED | populated_review, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |
| populated_review.findings[19] | ZTDE-RUNTIME-016-MEASURED | populated_review, desktop | Measurement record, no defect asserted. Original evidence retained in R1_AUDIT.json. |

Part 1 validation: 131 tests in 24 files pass. Further pages and states receive a fresh audit in Part 5.

## Finish final audit: every defect finding

The final raw report is FINISH_AUDIT.json. It reports 24 errors, zero warnings and 160 informational measurement records; all nine journeys passed. No runtime pass or certified gate is claimed. No suppression attributes were added. The final extended independent check passed 34 browser checks. Every expected sequential control was reached in exact order and its painted viewport intersection was visible and unoccluded; native date segments are the only allowed repeated element focus. Complete named traces, clipping coordinates, focus styles and collision results are in verification/final-audit-evidence.json. Screenshots are under /tmp/reuse-gate-visual/finish/audit-extended/.

| Original final finding | View | Verdict | Concrete evidence |
|---|---|---|---|
| runtime.findings[19]: ZTDE-RUNTIME-014, input | requests, phone320 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: requests-phone320. 29 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[24]: ZTDE-RUNTIME-014, input | requests, phone375 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: requests-phone375. 29 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[29]: ZTDE-RUNTIME-014, input | requests, tablet | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: requests-tablet. 37 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[34]: ZTDE-RUNTIME-014, input | requests, desktop | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: requests-desktop. 37 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[39]: ZTDE-RUNTIME-014, button | item, phone320 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: item-phone320. 13 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[44]: ZTDE-RUNTIME-014, #global-search | item, phone375 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: item-phone375. 13 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[49]: ZTDE-RUNTIME-014, button | item, tablet | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: item-tablet. 21 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[54]: ZTDE-RUNTIME-014, button | item, desktop | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: item-desktop. 21 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[59]: ZTDE-RUNTIME-014, #review | approvals, phone320 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: approvals-phone320. 19 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[64]: ZTDE-RUNTIME-014, #review | approvals, phone375 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: approvals-phone375. 19 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[69]: ZTDE-RUNTIME-014, #review | approvals, tablet | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: approvals-tablet. 27 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[74]: ZTDE-RUNTIME-014, #review | approvals, desktop | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: approvals-desktop. 27 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[79]: ZTDE-RUNTIME-014, #what-if-review | overview, phone320 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: overview-phone320. 24 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[84]: ZTDE-RUNTIME-014, #what-if-review | overview, phone375 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: overview-phone375. 24 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[89]: ZTDE-RUNTIME-014, #what-if-review | overview, tablet | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: overview-tablet. 32 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[94]: ZTDE-RUNTIME-014, #what-if-review | overview, desktop | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: overview-desktop. 32 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[99]: ZTDE-RUNTIME-013, a | radar, phone320 | False positive in this run: all actual Radar tab stops pass the visibility check | verification/final-audit-evidence.json: radar-phone320. The generic selector a does not identify a unique link. All 103 sequential controls, including every visible enabled link, were checked. Each focused control has a nonempty unoccluded painted intersection after clipping; see radar-phone320.png and the full focus trace. The raw center criterion is not used as a substitute for painted visibility. |
| runtime.findings[105]: ZTDE-RUNTIME-010, div.min-w-0 > main.min-w-0 > section.mb-8 > div.table-region | radar, tablet | False positive: raw rectangles ignore scroll clipping or ancestor relationship | verification/final-audit-evidence.json: radar-tablet. Zero collisions between independent painted bounds. See radar-bounds-tablet.png and the bounding-box arrays. |
| runtime.findings[110]: ZTDE-RUNTIME-010, div.min-w-0 > main.min-w-0 > section.mb-8 > div.table-region | radar, desktop | False positive: raw rectangles ignore scroll clipping or ancestor relationship | verification/final-audit-evidence.json: radar-desktop. Zero collisions between independent painted bounds. See radar-bounds-desktop.png and the bounding-box arrays. |
| runtime.findings[111]: ZTDE-RUNTIME-010, tbody > tr > td > a.request-link | radar, desktop | False positive: raw rectangles ignore scroll clipping or ancestor relationship | verification/final-audit-evidence.json: radar-desktop. Zero collisions between independent painted bounds. See radar-bounds-desktop.png and the bounding-box arrays. |
| runtime.findings[167]: ZTDE-RUNTIME-014, input | voice, phone320 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: voice-phone320. 32 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[172]: ZTDE-RUNTIME-014, input | voice, phone375 | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: voice-phone375. 32 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[177]: ZTDE-RUNTIME-014, input | voice, tablet | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: voice-tablet. 40 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
| runtime.findings[182]: ZTDE-RUNTIME-014, input | voice, desktop | False positive after exhaustive sequential focus check | verification/final-audit-evidence.json: voice-desktop. 40 named controls reached in exact order, visible and unoccluded. Native date subfields and roving/hidden tabs are accounted for. |
