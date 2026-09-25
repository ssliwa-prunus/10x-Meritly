---
name: 10x-status
description: Show status of changes by reading change.md frontmatter and parsing each plan's ## Progress section
argument-hint: "[change-id]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
---

# /10x-status — Change Status

Show the status of every change in the current project's `context/` tree by reading `change.md` frontmatter and parsing each plan's `## Progress` section. **No state file is consulted** — Progress is the single source of truth (see `references/progress-format.md`).

## Modes

- **No argument** — list every folder under `context/changes/` and `context/archive/` with status + Progress completion + drift warnings.
- **`<change-id>`** — single-change deep view: list every artifact under that change folder and report each one's presence/status.

## Per-change rendering

For each folder under `context/changes/<change-id>/` and `context/archive/<dated-id>/`:

1. Read `change.md` frontmatter to get `change_id`, `title`, `status`, `updated`, `created`.
2. If `plan.md` exists, parse its `## Progress` section:
   - `total` = count of `- [ ]` + `- [x]` lines under the Progress heading.
   - `done` = count of `- [x]` lines.
   - `current_phase`/`current_step` = the `### Phase N:` heading and the `N.M` index of the first `- [ ]` (or "all complete" if `done == total`).
3. Emit one line:

   ```
   <change-id> — <status> (<done>/<total> steps, current step <N.M>, updated <YYYY-MM-DD>)
   ```

## Resume hint

After listing, if any change has `status: implementing`, pick the most-recently `updated` one and copy the resume command to clipboard:

```bash
echo -n "/10x-implement <change-id> phase <N>" | pbcopy 2>/dev/null || echo -n "/10x-implement <change-id> phase <N>" | clip.exe 2>/dev/null || echo -n "/10x-implement <change-id> phase <N>" | xclip -selection clipboard 2>/dev/null || true
```

```powershell
# PowerShell (Windows)
Set-Clipboard "/10x-implement <change-id> phase <N>"
```

Mark that line in the output with `(✓ copied)`. Only ONE line gets the suffix — the most-recently updated implementing change.

If that change's Progress section has at least one `- [x]` row whose line ends with a ` — <sha>` suffix (7+ hex chars), append `(closed at <sha>)` to the resume hint, where `<sha>` is the SHA on the most-recently completed row (the last `[x]` preceding the first `[ ]`). Render `(✓ copied)` after `(closed at <sha>)`. Omit `(closed at …)` entirely on SHA-less rows.

## Consistency drift checks (warn-only, never blocking)

While rendering, surface drift between `change.md.status` and Progress reality. Warnings appear inline next to the change line:

| Condition                                                               | Warning                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `status: implementing` AND Progress has 0 `[x]`                         | `⚠ status drift: implementing but no progress`        |
| `status: implementing` AND every Progress item `[x]`                    | `⚠ status drift: should be implemented`               |
| `status: planned` AND any Progress item `[x]`                           | `⚠ status drift: should be implementing`              |
| `status: archived` AND folder is in `context/changes/` (not `archive/`) | `⚠ status drift: archived in wrong folder`            |
| Folder in `context/archive/` AND `status` ≠ `archived`                  | `⚠ status drift: in archive/ but status not archived` |
| `status: plan_reviewed` AND `reviews/plan-review.md` missing            | `⚠ missing plan-review artifact`                      |
| `status: impl_reviewed` AND no `reviews/impl-review*.md` present        | `⚠ missing impl-review artifact`                      |

Never error or exit non-zero on a drift — `/10x-status` is informational. The warning gives the user a nudge to fix `change.md` or move the folder.

## Single-change deep view (`/10x-status <change-id>`)

When invoked with a `<change-id>` argument, list every file under that change folder with a one-line description, then dump the full Progress section with SHAs rendered inline next to completed rows:

```
<change-id> — <status> (<done>/<total> steps, updated <YYYY-MM-DD>)

  change.md          ✓ frontmatter present
  frame.md           ✓ ([file size, line count])
  research.md        ✗ not present
  plan.md            ✓ ([N] phases; current step <N.M>)
  plan-brief.md      ✓
  test-plan.md       ✗ not present
  reviews/
    plan-review.md   ✓
    impl-review.md   ✗ not present
  follow-ups/
    review-fixes.md  ✗ not present

Progress:
  Phase 1: <phase title>
    [x] 1.1 <title> — <sha>
    [x] 1.2 <title>           ← SHA-less row (legacy / empty-diff phase)
    [ ] 1.3 <title>
  Phase 2: <phase title>
    [ ] 2.1 <title>
    ...
```

Render each Progress row preserving its `[x]` / `[ ]` mark and the original step index + title. For `[x]` rows, append ` — <sha>` ONLY when the source line in `plan.md` already carries the suffix; never invent or guess a SHA. SHA-less `[x]` rows render exactly as today (no suffix).

Resolve `<change-id>` to either `context/changes/<change-id>/` or `context/archive/<change-id>/` (the latter for changes whose archive folder retains the bare slug; archive folders may also be `<created-date>-<change-id>/` — try both).

## Execution sketch

```bash
# 1. List all changes (active + archived)
find context/changes context/archive -mindepth 1 -maxdepth 1 -type d 2>/dev/null

# 2. For each, read change.md frontmatter (status, updated, title)
# 3. For each, parse plan.md ## Progress section if present
# 4. Render one line per change with completion + drift warnings
# 5. Pick the most-recently updated `implementing` change → clipboard hint
```

## Important Notes

- **Progress is authoritative.** Never read or write any state-file sidecar. Never grep for HTML comment progress markers.
- **Drift checks are warn-only.** Surface mismatches; don't fix them automatically. The user updates `change.md` or moves the folder if the warning is real.
- **Archive entries are read-only.** Render them, but don't suggest commands that would write inside `context/archive/`.
- **Speed**: for the no-argument list, prefer one batched read of all `change.md` frontmatters and a single grep over plan.md Progress sections rather than reading each plan in full. Parsing now needs the trailing ` — <sha>` suffix as well as the `N.M` index, but it remains a single-pass regex over the Progress section — no extra file reads.
