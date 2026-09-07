#!/usr/bin/env bash
# Deletes the remote branches recorded in docs/deleted_branches_2026-09-07.md.
#
# The cleanup session that generated this could not run the deletes itself:
# its git proxy answers 403 to a delete-ref push (a normal push succeeds, so
# it is the delete that is refused, not the credentials). Run this from a
# checkout that can push, e.g. a local clone.
#
# Recovery for anything deleted here is the SHA table in that same document.
set -euo pipefail

BRANCHES=(
  claude/admin-event-review-tool-rz5ejb
  claude/admin-notification-config-i2dn49
  claude/appt-requests-page-gaj1wg
  claude/assistance-tag-form-questions-lawg6h
  claude/auto-create-signin-sheets-n69rpu
  claude/auto-roster-notify-setting-vmv8nc
  claude/cal-duplicate-registration-links-pcrqy3
  claude/cal-event-email-sharing-96hcog
  claude/caroline-email-feedback-xubnhm
  claude/caroline-email-issue-jt9kqd
  claude/caroline-email-review-u5fmxb
  claude/codebase-modularization-emkz1q
  claude/codebase-review-simplify-n1tfaq
  claude/dashboard-links-deleted-forms-59z6wj
  claude/dashboard-reorganization-q13rj5
  claude/destroy-rebuild-forms-optimize-j4k8nc
  claude/door-app-optimistic-signin-mvr7uu
  claude/door-walk-in-search-prompt-kv7rxr
  claude/duplicate-forms-rebuild-w4wwmp
  claude/eff-1-sectioned-row-cache
  claude/eff-2-form-handle-cache
  claude/eff-3-sectioned-single-read
  claude/eff-4-header-scan-bound
  claude/eff-5-retire-walkin-page
  claude/eff-6-door-route-table
  claude/eff-7-membership-at-the-door
  claude/eff-8-sliced-job-runner
  claude/eff-9-rationed-mailer
  claude/final-system-pass-cj1z1j
  claude/form-deadline-config-3lecu7
  claude/form-descriptions-lunch-format-xlfzau
  claude/form-descriptions-lunch-logging-wcrjn2
  claude/frontend-checkin-system-options-o8fo42
  claude/grouped-events-locations-igf2jj
  claude/hide-superseded-registrations-bhhsmf
  claude/live-signup-sheet-instructors-ki4xyj
  claude/load-nonweekday-event-menu-n0w1v7
  claude/lunch-form-routing-m5uxms
  claude/lunch-forms-guest-meals-a6sn5e
  claude/lunch-forms-not-showing-3pg8ua
  claude/lunch-menu-push-robustness-pckwcl
  claude/master-dashboard-condensing-q6ugc5
  claude/meal-tracking-design-8corfb
  claude/member-roll-lunch-column-lgvj8u
  claude/merge-metrics-orphaned-sessions-79bxtt
  claude/merge-todays-chats-main-swbo6e
  claude/multiple-meals-per-person-location-aherxd
  claude/organize-system-created-files-logg7l
  claude/orphaned-session-rows-6prodn
  claude/pa-admin-review-management-m8fwp6
  claude/pa-calendar-write-bug-7sj2ow
  claude/personalized-assistance-events-u8c54m
  claude/port-metrics-yoy-indicators-uw72nx
  claude/products-editable-sharing-gxg1zo
  claude/program-registrant-notifications-4fg7lw
  claude/program-review-errors-gyb20k
  claude/quick-mark-perf-sheet-defaults-kifpyf
  claude/recurring-mark-entries-date-nk2alf
  claude/registrant-dashboard-refinements-byduge
  claude/registrants-meal-tracking-columns-f7ryg0
  claude/registration-club-checkboxes-q59x05
  claude/remove-excess-sheet-rows-q5epcw
  claude/review-programs-batch-update-rbdqoz
  claude/senior-center-form-redesign-n5xwc5
  claude/signin-guest-organization-4ztsli
  claude/signin-sheet-output-rewrite-3y29x0
  claude/stress-test-bugs-vxxms7
  claude/trigger-coordination-guards
  claude/waitlist-only-status-dropdown-kp1sce
  claude/walk-in-signin-registration-0xpu7e
  claude/walking-club-form-rebuild-6vomk6
)

git push origin --delete "${BRANCHES[@]}"
