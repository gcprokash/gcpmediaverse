# MediaVerse Database Upgrade — Phase 2 Foundation

**Status:** Draft / non-production  
**Branch:** `phase-2-database-foundation`  
**Production changes:** None. This document does not change Google Sheets, scheduled scanners, or the live website.

## Goals

- Preserve all current website behavior and the existing Google Sheets as the production source.
- Keep the current stable `Media_ID` and track IDs; do not regenerate identifiers during migration.
- Make scanner writes safer and schema changes explicit.
- Prepare a provider-neutral file reference model so Telegram access can be added later without putting bot credentials in Sheets.

## Workbook snapshot reviewed

The supplied Excel exports contain:

### Main database

| Tab | Data rows | Current columns |
|---|---:|---:|
| Media | 37 | 18 |
| Files | 37 | 8 |
| Video | 50 | 16 |
| Audio | 84 | 13 |
| Subtitle | 172 | 8 |
| Covers | 37 | 6 |
| Lyrics | 0 | 10 |

### Assets database

| Tab | Data rows | Current columns |
|---|---:|---:|
| Covers | 35 | 4 |
| HiResAudio | 36 | 5 |

Counts exclude the header row and trailing empty spreadsheet rows/columns.

## Confirmed findings

1. All 37 `Media_ID` values in `Media` are unique.
2. `Files`, `Video`, `Audio`, `Subtitle`, and Main DB `Covers` contain no duplicate primary IDs in the supplied export.
3. All foreign `Media_ID` references in those five tabs resolve to a row in `Media`.
4. Per-media Audio and Subtitle row counts reconcile with `Media.Audio_Count` and `Media.Subtitle_Count` in the export.
5. `Files` has five trailing blank header columns; Main DB `Covers` has two; Assets `HiResAudio` has 21.
6. `Lyrics` has two columns named `Status`; it has no data rows.
7. The Main DB `Covers.Drive_URL` values are blank in this export, while `Cover_URL` points to local `covers/*.svg` paths.
8. The Assets workbook contains separate `Covers` and `HiResAudio` inventories. The website currently reads these two Assets tabs and the Main DB `Media` tab.
9. The exported `Video` rows include codecs `mjpeg` (12 rows) and `png` (1 row), alongside conventional video codecs. These should be classified from the scanner's stream metadata before being treated as playable video tracks; codec alone is not enough to infer a container attachment in every file.
10. `Audio.Artist` is blank for all 84 rows in the supplied export. `Audio.Language` is blank for 38 rows; `Subtitle.Language` is blank for 137 rows. These are missing metadata, not safe values to auto-fill.

## Important implementation observations

- `app.js` loads only Main DB `Media`, Assets `Covers`, and Assets `HiResAudio` for the current website.
- The metadata scanner owns the Main DB tabs `Media`, `Files`, `Video`, `Audio`, `Subtitle`, and `Covers`.
- The two asset scanners own Assets `Covers` and `HiResAudio`.
- The scanners currently clear their target ranges and rewrite the tabs. The metadata scanner uses fixed header arrays. The Covers and HiResAudio scanners use four and five columns respectively.
- Therefore, manually adding columns to scanner-owned tabs without updating the scanner header contract will cause those columns to disappear on the next scheduled scan.

## Proposed next changes (not yet applied)

### A. Scanner safety and schema governance
- Define one explicit schema version and header contract per scanner-owned tab.
- Validate required headers, row shape, unique IDs, foreign keys, and count reconciliation before any clear/write operation.
- Abort a write on unexpected empty scans, parse failures, or validation failures; keep the previous sheet contents intact.
- Write to a staging tab/range first, validate, then replace the target contents in a single controlled operation where feasible.
- Emit a scan summary: discovered, parsed, skipped, duplicate, invalid, and written counts.
- Keep existing column names and order during the first migration; append new optional columns only after both scanner and website readers are updated.

### B. Track classification
- Add a reliable stream classification such as `Stream_Type` (for example `video`, `image_attachment`, `unknown`) only after confirming the source parser exposes stream type/disposition/attachment metadata.
- Do not delete or discard existing `mjpeg`/`png` rows; preserve them as metadata until classification is verified.
- Keep playable video selection separate from embedded image attachments.

### C. Lyrics tab
- Resolve the duplicate `Status` header before first population. Proposed distinct fields: `Status` and `Review_Status`, but final names depend on intended workflow.
- Do not fabricate lyrics rows or infer language when the source is blank.

### D. File access abstraction (Telegram-ready, not implemented)
- Keep `Media_ID` and `File_ID` as stable internal identifiers.
- In a future provider-neutral file registry, store provider, provider file reference, access URL (if appropriate), MIME type, size, availability, and last-verified timestamp.
- Telegram Bot token and other secrets must live in GitHub Actions secrets or a secure server environment, never in Sheets, repository files, or client-side JavaScript.
- Telegram access must be server-side; do not expose bot tokens or private file references in public website JavaScript.
- The future Telegram feature should be additive and must not replace existing Google Drive links until separately tested.

## Migration / release sequence

1. Create and verify separate Google Sheets copies and offline exports. (Only the supplied XLSX copies have been backed up in this work session; no live Google Sheets copy has been created.)
2. Test scanner parsing and validation against exported fixtures.
3. Update scanner and website readers together on this feature branch.
4. Run automated tests and compare generated rows against the current export.
5. Review a draft PR; do not merge automatically.
6. After explicit approval, create a fresh production backup and apply the controlled Google Sheets migration.
7. Verify the live site and scheduled scanner runs.

## Explicit non-actions

- No Google Sheets cells or tabs were edited.
- No GitHub Actions workflow was run.
- No production branch was changed.
- No PR was merged.
- No Telegram bot or token was configured.
