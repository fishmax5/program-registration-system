# Deleted branch recovery manifest

Remote branches deleted on 2026-09-07 during branch cleanup.
Any of these can be restored with:

```
git push origin <sha>:refs/heads/<branch-name>
```

GitHub retains unreferenced commits for a limited time; after that a
SHA here may no longer resolve. Nothing in the *merged* table is at
risk — those commits all live in `main`.

## Merged into `main` (no work lost)

| Branch | SHA |
|---|---|
| `claude/admin-event-review-tool-rz5ejb` | `00ee14def2dfd8fb6e8e53990278a269b5474194` |
| `claude/admin-notification-config-i2dn49` | `21b37f8949a0e1e45a5dba0cdd50eb113046207b` |
| `claude/appt-requests-page-gaj1wg` | `854381350c7d5e67ffbb16b8237ba76ad21a2f84` |
| `claude/auto-create-signin-sheets-n69rpu` | `cb3bc0b102f964258cb440bf61c0a6a535aeebaa` |
| `claude/auto-roster-notify-setting-vmv8nc` | `287edcc912d6fdb65dc2fe63cd8b334dda5be28a` |
| `claude/cal-duplicate-registration-links-pcrqy3` | `5370204b3b73ef53fb585662989b8d661463e435` |
| `claude/cal-event-email-sharing-96hcog` | `c55cc19a8eb9ead9b14efa10430f02790d5bfa28` |
| `claude/caroline-email-feedback-xubnhm` | `7dd009c7a902049c6cd24f4393c27d73bef4bd5c` |
| `claude/caroline-email-issue-jt9kqd` | `12fa54bfd22f48cfb1fdc9d6f77232338e49d5a2` |
| `claude/codebase-modularization-emkz1q` | `39b1e3ca07de127f46842eb02b69cbed43f3e8d2` |
| `claude/dashboard-links-deleted-forms-59z6wj` | `47789bae6e041a8fc2c550b509872fabdf75ee0a` |
| `claude/dashboard-reorganization-q13rj5` | `78a16d0e5c6edc8bd6793e858bdc3054f450b493` |
| `claude/door-app-optimistic-signin-mvr7uu` | `a5fbf2d17921d128d96833399ba368f5a79d2559` |
| `claude/door-walk-in-search-prompt-kv7rxr` | `41688bf1436ac2becbcbb78b042dcae1bc57aaf1` |
| `claude/eff-1-sectioned-row-cache` | `eb0223855d89cd97607ed872e461206bea3cf5ea` |
| `claude/eff-2-form-handle-cache` | `62dcf92868ee4e7804e1189988bff44c5319290c` |
| `claude/eff-3-sectioned-single-read` | `488a9f2ba60e679619fbc5cca2c3f83d3cd5cf95` |
| `claude/eff-4-header-scan-bound` | `385ba746b6be423edce470f5a8d68cd602f7301e` |
| `claude/eff-5-retire-walkin-page` | `f80953873eb3d06e4b347da1a3a635cbcd4a68bb` |
| `claude/eff-6-door-route-table` | `b689fafed560dc114954d2478b06ccfeea2422ea` |
| `claude/eff-7-membership-at-the-door` | `7e5492bafd7d0423003f90258d5e5dfa642c676c` |
| `claude/eff-8-sliced-job-runner` | `56f0c932b5d39673a4fd9756f767da6afbb0ee2d` |
| `claude/eff-9-rationed-mailer` | `5257c21c6c3fbb35bdc147458c5fb6db0960fbd6` |
| `claude/form-descriptions-lunch-format-xlfzau` | `4ec6f2768ccd505ef501cea5119be5803c4a8776` |
| `claude/form-descriptions-lunch-logging-wcrjn2` | `2d3b41240581f0fe947abaae719c0ea9f75426e3` |
| `claude/frontend-checkin-system-options-o8fo42` | `b7d4050f4ee19df0cbce3a8707735810d4b3b338` |
| `claude/hide-superseded-registrations-bhhsmf` | `4dc9f92328d4cbc87260bf42bf355934fd3c7531` |
| `claude/load-nonweekday-event-menu-n0w1v7` | `031938f556a9a67519491e42fed8462276d0ea93` |
| `claude/lunch-form-routing-m5uxms` | `06a973e7268031f8631e09b9a36e77fde0dd9af0` |
| `claude/lunch-forms-guest-meals-a6sn5e` | `0e2155d1571316e47a9e60f90acb9415e69019ba` |
| `claude/lunch-menu-push-robustness-pckwcl` | `5d9242e3d809a09f1ed8815fb6e01a8af31b6217` |
| `claude/master-dashboard-condensing-q6ugc5` | `fccb43c6d02d898ce65ec92f9bf0e53c598d45c5` |
| `claude/member-roll-lunch-column-lgvj8u` | `d68b93966fadb6819d95d066ab00246893ff6077` |
| `claude/merge-metrics-orphaned-sessions-79bxtt` | `3821282deee1836b432e87e2f26908245036d9e7` |
| `claude/merge-todays-chats-main-swbo6e` | `291915c7d883ed95558c0db7c2f668d91f9c9683` |
| `claude/multiple-meals-per-person-location-aherxd` | `52bd7d3db10cf7303f623295bb1fd8c22f1dbbef` |
| `claude/organize-system-created-files-logg7l` | `bb4b55fd5a7741692c0121769209853b63af444a` |
| `claude/orphaned-session-rows-6prodn` | `f8e52eb6b30bf9d39008e61933107372bbc8c321` |
| `claude/pa-admin-review-management-m8fwp6` | `d3ced9e071967d716369350c0d31ffc914fbeb6a` |
| `claude/pa-calendar-write-bug-7sj2ow` | `e8ce7c80b6dd2866b91ab723f82e2d78132207e1` |
| `claude/personalized-assistance-events-u8c54m` | `ed45d1ef2df698b6af39ba8cd63cc9625c3570e0` |
| `claude/port-metrics-yoy-indicators-uw72nx` | `c3b332364b11578dc59950f860c58f55237bc6a0` |
| `claude/products-editable-sharing-gxg1zo` | `81c2141d49a8ded8c44f1d063670d0cc3d0557a6` |
| `claude/program-registrant-notifications-4fg7lw` | `b79b86303792e760f01eb8d08d432bd4455c2597` |
| `claude/program-review-errors-gyb20k` | `cbaffb9970c30e794456512c9c69e8cc22769f95` |
| `claude/quick-mark-perf-sheet-defaults-kifpyf` | `f4dd153203d58f4730fa250851583163774b274c` |
| `claude/recurring-mark-entries-date-nk2alf` | `4f05c1ddb710a0f3ba4a07bdc179bf3fc3a2047e` |
| `claude/review-programs-batch-update-rbdqoz` | `39787c0914d5ec426a7033398cd9340acb84053d` |
| `claude/signin-guest-organization-4ztsli` | `f081f4d002ead6dcd4ba9ba62dacddc55441f36e` |
| `claude/signin-sheet-output-rewrite-3y29x0` | `f62d48252a03b4b4318cae15c12adbfd39b786cf` |
| `claude/waitlist-only-status-dropdown-kp1sce` | `70adfa0d871fee47987cc60dececdd019bce65e4` |
| `claude/walk-in-signin-registration-0xpu7e` | `a3e8078e9c27c8f678399d7bdf888e078c2587cf` |

## Unmerged, no activity since August (work discarded)

| Branch | Last commit | Commits ahead of main | SHA |
|---|---|--:|---|
| `claude/assistance-tag-form-questions-lawg6h` | 2026-08-21 | 74 | `ecd5da7ccb93b6916a3034f234006fb2e151a8e2` |
| `claude/caroline-email-review-u5fmxb` | 2026-08-20 | 71 | `e02727154892deee92ce25069812b542953dede0` |
| `claude/codebase-review-simplify-n1tfaq` | 2026-08-22 | 86 | `22059ddfc6eb62365ddf08cb3b5eecb9a5f9e69e` |
| `claude/destroy-rebuild-forms-optimize-j4k8nc` | 2026-08-12 | 56 | `b77ed6f311e9d0b428353abb7d32e5d25d358f49` |
| `claude/duplicate-forms-rebuild-w4wwmp` | 2026-08-16 | 63 | `241ce1cccac17e016558615bb477e0dd5973219e` |
| `claude/final-system-pass-cj1z1j` | 2026-08-04 | 34 | `9a31da0ae952b49f584cf78a99bb341714ffb3df` |
| `claude/form-deadline-config-3lecu7` | 2026-08-21 | 72 | `732e0fe98f31eddfa01b82b71f7f0de1db41c982` |
| `claude/grouped-events-locations-igf2jj` | 2026-08-10 | 49 | `8ac4120aa515277c375fe742d0e16860ab93ad78` |
| `claude/live-signup-sheet-instructors-ki4xyj` | 2026-08-20 | 69 | `83c963b943c0b4f822902cae06426cd7ed6e9902` |
| `claude/lunch-forms-not-showing-3pg8ua` | 2026-08-21 | 77 | `c2d510ef389926df66c53ced6a26b50ab5cde4d9` |
| `claude/meal-tracking-design-8corfb` | 2026-08-14 | 62 | `ed46c10addffb56bba45952ac497bc555827a023` |
| `claude/registrant-dashboard-refinements-byduge` | 2026-08-19 | 68 | `8e418b4acf3b900c8a40de0250ed695fa6f3b6d4` |
| `claude/registrants-meal-tracking-columns-f7ryg0` | 2026-08-10 | 50 | `fe8bc05c7dda3323ef5124ea837874fa41047480` |
| `claude/registration-club-checkboxes-q59x05` | 2026-08-13 | 56 | `063ec9d57d075ce8b86f4e6a592c76d266b2259a` |
| `claude/remove-excess-sheet-rows-q5epcw` | 2026-08-26 | 1 | `da0fe0cdb614d57073c42ae9f2567d3b68c64d9d` |
| `claude/senior-center-form-redesign-n5xwc5` | 2026-08-11 | 53 | `6037f7c976badb62f8e8d5ec545152d9d2f69abe` |
| `claude/stress-test-bugs-vxxms7` | 2026-08-17 | 65 | `ff2839fcb6020230ac996b284a1e8ad1bcad8dbf` |
| `claude/trigger-coordination-guards` | 2026-08-05 | 34 | `815a99919b6b33ad61759fa6a71b5c69a7c2e71c` |
| `claude/walking-club-form-rebuild-6vomk6` | 2026-08-24 | 5 | `28f343fce60b3beec6a51107791c2a5c7384d184` |

## Kept

| Branch | Why |
|---|---|
| `main` | default branch |
| `claude/quick-mark-future-events-4mv1ph` | open PR #2 |
| `claude/copy-office-daily-digest-lsjy2k` | unmerged, active September |
| `claude/master-program-dash-date-1i8nsi` | unmerged, active September |
| `claude/metrics-page-yoy-indicators-on8uyu` | unmerged, active September |
| `claude/metrics-kpis-monthly-aj1lnt` | unmerged, active September |
| `claude/cleanup-old-branches-aixs9x` | this cleanup |
