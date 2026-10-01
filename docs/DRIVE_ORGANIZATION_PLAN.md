# Drive organization plan

Survey taken 2026-10-01 through the Google Drive connector, as
maxfishman@newhorizonsseniorcenter.org. Nothing was trashed, renamed or
reshared. The code change that goes with this plan is in
`82_drive_organization.gs` (section 82b) and its callers.

## 1. Survey

### Where the system actually lives

The workbook, **Event and Lunch Master Sheet**
(`1tSBr8gri26Wqx6edgrmFaU7TtxQbIXfEind-3fcpFE8`), sits at the **root of a
shared drive** (`0AA8tba6gNPCmUk9PVA`). `getSystemRootFolder()` therefore
resolves the anchor to the shared drive's root, and every folder this system
has made since `82` shipped landed at the top of that drive, beside the
workbook. That is the mess staff see.

The folder named **Program Registration System**
(`11E9bqbxKh-ii__WzWgUwLQ7-gujq0P9-`) is not the anchor. It holds one orphaned
template form and nothing else.

### Shared drive root (`0AA8tba6gNPCmUk9PVA`): 17 items

| Item | Kind | Contents | Class |
|---|---|---|---|
| Event and Lunch Master Sheet | the workbook | — | (a) staff, **never move** |
| Program Registrant Sheets | folder | 80 registrant sheets | (a) staff, since leaders open these |
| Sign-In Sheets | folder | 29 live sign-in Docs | (a) staff, since the desk prints these |
| Membership Application | form | read by Config's membership form id | (a) staff, so leave it |
| Program Registration Forms | folder | 100+ generated forms (99 forms + 1 sheet on the first page alone) | (b) system |
| Printed Sign-In Sheets | folder | 11 retired PDFs, plus a legacy `Instructor Sign-Up Sheets` subfolder holding 2 live rosters | (b) system |
| Form Images | folder | `Games` → `Brain Games`, `Chess`, `Mah Jongg`, `Pinochle` (staff-made subfolders) | (b) system |
| Registrant Snapshots | folder | 13 CSVs (`99j`) | (b) system |
| Ledger Archive | folder | empty (`99za`) | (b) system |
| Public Schedule Snapshot ×2 | folders | twins created 0.7s apart on 2026-09-28. `1a7d3y8s…` holds the live JSON and `1kkkbZuV…` a stale one | (b) system |
| TEMPLATE — Registration Form Base ×4 | forms | only one is the live template (Script Property) | (b) system |
| Program Registration System | folder | 1 orphaned template form | (b) system leftover |
| Copy of Event and Lunch Master Sheet - September 17, 12:06 PM | sheet | a version-history copy used for a restore (`99p`) | (b) backup |

### My Drive root: 14 items before the moves (3 folders, 11 loose files)

The folders are `Notes` (partner/contact notes), `Program Specifics` (with
`Garden`) and `Old`. Most loose files were garden-project documents, a partner
note, a Mah Jongg spreadsheet, a stray copy of a registrant sheet, and four
general working documents. None of them are system files. All are class (c)
or loose staff files. See §3 for what was moved.

### Second shared drive (`0AJTrS0Q-V6n4Uk9PVA`)

This drive holds `Master Network List`, `Weekly Communications`, `Photos` (a
deep photo tree) and `Give Butter Export`. None of it belongs to this system,
and it is already in folders, so nothing was touched there.

### Other findings

- **About 16 registrant sheets are owned by admin@newhorizonsseniorcenter.org
  and have no parent visible to this account.** They are probably in admin's
  own My Drive, created by a trigger running as admin. The Admin sweep's
  registry pass, run as admin, files them into `Program Registrant Sheets`.
  Run it from admin's account, or from any account that can move them.
- **`Instructor Sign-Up Sheets`** (the legacy roster folder name) sits inside
  `Printed Sign-In Sheets` and still holds 2 live rosters ("Sign-Up Sheet —
  Computer Tech Support", "Sign-Up Sheet — Chess Instruction"). The lookup
  never adopts it, because `Program Registrant Sheets` already exists. The
  sweep's registry pass moves both sheets into `Program Registrant Sheets`.
- **The daily registrant snapshot runs twice a night**, at 03:50 and 03:54,
  with identical sizes. This points to a duplicate trigger or the hourly
  `snapshotRegistrantsIfDue_` racing the 3am trigger. It is harmless, but
  worth a look. This change does not address it.
- **Twin folders come from racing executions.** Two runs that both missed
  "Public Schedule Snapshot" each created one. The new
  `pickSystemFolder_()` makes every run choose the same twin (the earliest
  created), so the two stop diverging.

## 2. Proposed layout

```
Shared drive (0AA8tba6gNPCmUk9PVA)             ← the anchor
├── Event and Lunch Master Sheet               (the workbook — never moved)
├── Program Registrant Sheets/                 staff: leaders' rosters
├── Sign-In Sheets/                            staff: desk sign-in Docs
├── Membership Application                     staff (Config reads it)
└── System/                                    buried — only the code reads these
    ├── Program Registration Forms/
    ├── Printed Sign-In Sheets/
    │   └── Instructor Sign-Up Sheets/         (legacy; empty once the sweep runs)
    ├── Form Images/
    ├── Registrant Snapshots/
    ├── Public Schedule Snapshot/              (live JSON)
    ├── Public Schedule Snapshot/              (twin, stale JSON)
    ├── Ledger Archive/
    ├── TEMPLATE — Registration Form Base ×4
    ├── Program Registration System/           (orphaned template; manual move)
    └── Backups/                               (manual: version-history copies)

My Drive
├── Notes/
├── Program Specifics/
│   └── Garden/
├── Old/
└── (4 general working docs, left for their owner to file)
```

## 3. Moves made now (My Drive only, category (c) and loose staff files)

| Name | From | To | File id |
|---|---|---|---|
| Garden Partners at Ashbridge | My Drive root | Program Specifics/Garden | `1z0UqFeDMSa37HQ5dxQbkLZvK5XEyYJSGQMqEZwxwqqc` |
| Ashbridge_Garden_Partner_Contacts | My Drive root | Program Specifics/Garden | `13zpnQgMfOEuJx1k2Xr77oFXOmS3EBT3LLbhk-3zoU_Q` |
| Ashbridge_Garden_Partner_Contacts (earlier copy) | My Drive root | Program Specifics/Garden | `15bFA7uCXJclFGMBo9bFr1G_uWXl8OIyy0Qhxflp4Ph8` |
| Volunteer Waiver_ Garden Construction.docx | My Drive root | Program Specifics/Garden | `1hpa9OKfxDfGVotG8CV7OpDhrQH9OTLMh` |
| Kate - Golden Wild Cats Villanova + Presidential Scholarships Service | My Drive root | Notes | `1ddX_692sdhZgpS14LUFEL0BybD8G7Ql-jYUQaYFTZeY` |
| Mahjong Tuesday Ashbridge.xlsx | My Drive root | Program Specifics | `1pGZ5d_ViXqRBe7TiPLFVta2FvQ5tCagF` |
| Copy of Registrant Sheet — Advanced Stitch Club (Ashbridge) | My Drive root | Old | `1oEZVj5C-nT7Su0Y4RWISsQRCM8vZLYOaJLtfgKt8B8s` |

Folder ids: Garden `1dJ2zclRcA7jbjI4w6licBD9l8Ix_BepY`, Notes
`1o0tuXLGsIbcWzFckk29aQWNR2vnW4dMU`, Program Specifics
`1CG7loqhVxyV9NiThSWoHZR834E87EQIm`, Old `11xlooihJA-mbAFHYfxrT5rK_lZL0LXqO`.

I left four files in My Drive root because none has an obvious home. Their
owner should file them: `Task Tracking`, `Internship Outline`,
`NHSC_Work_Areas_Sketch` and `NHSC_Peer_Benchmarking_ALPHA`.

## 4. After deploy

**Do none of these before the new code is deployed.** The deployed code does
not know about `System`. If a folder is moved there, its first lookup misses
it, and its Drive-wide fallback moves the folder straight back to the drive
root on the next sync.

1. Deploy the new `.gs` files.
2. Run **🔧 Admin ▸ One-Time Jobs ▸ 🗂️ Organize Generated Files** once, ideally
   as admin@ so it can reach the admin-owned rosters. It does all of the
   following by itself:
   - creates `System` at the shared drive root;
   - moves `Program Registration Forms` (`11QiNx6TyS5BpNLjbFujuST11luoT8FbX`),
     `Printed Sign-In Sheets` (`1PD-JNnWpSLdTejc7u3pUUi47KXRr0XNu`),
     `Form Images` (`1GsFTSDkyroVPCGPBrYamDlrU5Xh0Wevt`),
     `Registrant Snapshots` (`1-ONZ4x-aEd5oELEwxe7D4tgbCQ-kZ9QL`),
     `Ledger Archive` (`1wuBZCNdrtKYDgrNHnl5vhh-1QmHAW-nL`) and both
     `Public Schedule Snapshot` folders (`1kkkbZuVb1qedb8tx0Ay3ajEatIqZztq6`,
     `1a7d3y8slZC17VIcLp2VW4dtbZQWKHQW-`) into `System`;
   - moves the four top-level template forms (`1jEB_DTTaAvn-jmybtyg4JKAYVlMf_LnfMcEGYETdqCs`,
     `1brBUO2pv-7Ctn3oKkOQYUB8-ve3zSBYaQn3PHIoXGJA`,
     `1uRXCPbOdEInKW8blbcb0Iq2qb68FDnEhKxZDRwU4YZs`,
     `13hz7qkYp662pQCgi0GQ2JXztPjAlMvHjexWB4TF-Z8M`) into `System`;
   - files every registered roster into `Program Registrant Sheets`, including
     the 2 in `Instructor Sign-Up Sheets` and admin's ~16.
   - Leaves `Program Registrant Sheets` and `Sign-In Sheets` where they are.
3. These have to be moved by hand afterwards, because no code knows them by
   name:
   - `Program Registration System` (`11E9bqbxKh-ii__WzWgUwLQ7-gujq0P9-`, with
     orphaned template `13h1j_eTLACkYCj1bIq9jEeSodTEzKuCUaKvGo4VZlfU`) → `System`.
   - `Copy of Event and Lunch Master Sheet - September 17, 12:06 PM`
     (`1kIWzOWU_1V29p_EeYRcZ2JZipns2f39cNWLk22oRLSs`) → `System/Backups`
     (create the folder by hand).
   - Optional: once the sweep has emptied `Instructor Sign-Up Sheets`
     (`1UTEn27KFCuj5q-9csaol-d2oMQ7bDOZP`), it can go to `Old`. Do not trash it.
4. The live JSON is found by id, so the twin `Public Schedule Snapshot` folders
   are harmless side by side in `System`. Afterwards a person may move the stale
   twin's JSON (`1ddom6zYLwNHFtbVVYV0f3k0AoAMoaRAr`) out of the way. Do not
   delete the live one (`1KlY8l1S_kF-rkukf0BTIw-D4k4TdDFED`).
