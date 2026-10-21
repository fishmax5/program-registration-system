# R9 — the public pages as files on GitHub Pages

Code: `99zu_github_pages_publisher.gs`, `91_public_embeds.gs` (banner 18c),
`87`/`93` (`options.static`), `99y` (the hook), `86` (the snippet).
Tests: `tests/github_pages_publish.test.js`, `tests/public_static_pages.test.js`.
Measurement: `tools/public_pages_bench.js`.

## What changes for a visitor

Nothing, unless an admin turns it on. When on, the embed snippet in the Door
Pages dialog frames `https://<owner>.github.io/<repo>/index.html?embed=1`
(and `regular.html`) instead of the `/exec` address. Printed `?mode=public`
links are untouched and keep serving from Apps Script.

## Setup (once)

1. **Create a PUBLIC repository** on GitHub (any name; `public-schedule` below).
   Add nothing to it — the first publish creates the files.
2. **Turn Pages on**: repo ▸ Settings ▸ Pages ▸ Source "Deploy from a branch",
   branch `main`, folder `/ (root)` (or `/docs` — then give `main docs` at the
   second prompt). Without a custom domain the site is
   `https://<owner>.github.io/public-schedule/`.
3. **Create a token**: GitHub ▸ Settings ▸ Developer settings ▸ Fine-grained
   tokens. Resource owner: the account/org that owns the repo. Repository
   access: **Only select repositories → the one repo**. Permissions: **Contents:
   Read and write** (nothing else). Pick the longest expiry you are comfortable
   with and put the expiry date in a calendar — an expired token is the failure
   mode here (see "When it stops" below).
4. In the workbook: **Admin ▸ Sign-In & Door ▸ Public Pages on GitHub Pages…**
   Four prompts: `owner/name`; `main` (or `main docs`); the token; a base URL
   only if you use a custom domain. The item checks the token against GitHub,
   publishes the four files once, and tells you the address. Run **Refresh My
   Permissions** first if Apps Script asks to authorize `script.external_request`.
5. Wait a minute or two for GitHub to build, open the address it printed, and
   check the calendar draws. Re-open **Door Pages**: the snippet now frames the
   Pages address (it stays on the Apps Script address until all four files have
   been pushed, so there is no 404 window).

The token is kept in Script Properties (`PUBLIC_PAGES_GITHUB_TOKEN_V1`) and is
visible to anyone who can edit the script project — treat it as scoped to one
public repo of schedule data, which is why it is that narrow.

## What it publishes, and what it does not

`schedule.json` is exactly the snapshot `99y` already stores; `regular.json` is
its weekly fold; the two HTML pages hold no data. No names, no counts of who.
`tests/github_pages_publish.test.js` pins this next to the field list in
`tests/public_calendar.test.js`.

## How often

After every snapshot rebuild (the 10-minute trigger, and the end of a calendar
sync), and only the files that changed (hash taken without `builtAt` /
`generatedAt`). Unchanged JSON is re-pushed every 3 hours as proof of life.
Expect: roughly one commit per changed file per rebuild that sees a change, so
the repo history grows with seat changes. Squash or prune it occasionally if
that matters; nothing reads history.

The footer's "Updated …" is the time the data last CHANGED (or the last
heartbeat), not the last check.

## When it stops

- A refused push is logged and, after three runs in a row, filed once a day in
  the office digest ("Public schedule"). Pages keeps serving the last files.
- Once the published JSON is more than 12 hours old, each static page sends its
  visitor to the Apps Script page instead (query string preserved). So an
  expired token degrades to today's speed, not to a stale calendar.
- Renewing: run the same menu item and paste the new token (leave the other
  prompts as they were).

## Rollback

Admin ▸ Sign-In & Door ▸ Public Pages on GitHub Pages… → type `OFF` at the first
prompt. It forgets the settings, the token and the state; the embed address goes
back to Apps Script at once. Then update any website that pasted the Pages
snippet (the GitHub files stay, harmlessly, and fall back to Apps Script once
stale). To remove the site entirely, delete the repo.

## Measuring

```
node tools/public_pages_bench.js \
  --exec  "https://script.google.com/macros/s/<id>/exec?mode=public&embed=1" \
  --pages "https://<owner>.github.io/public-schedule/index.html?embed=1" \
  --runs 7 --profile phone
```

Cold = a fresh browser context per run (first-time visitor); warm = the second
load in the same context. "tile" is time to the first program tile in any frame,
which is what a person waits for (the Apps Script page draws inside a nested
iframe). `--self-test` runs both page forms against local servers and so
measures only the pages' own cost, not Google's redirect/wrapper/execution —
never quote it as a before/after.
