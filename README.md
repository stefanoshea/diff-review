# diff-review 0.1

## What it is

diff-review shows a diff in a pane inside Claude Code. You and Claude add draft comments on any line, and you send the comments as a pending review on the pull request, which you then submit on GitHub.

The main use: review a colleague's pull request from your terminal without checking it out.

```
/diff-review 2148
```

What you get:

- The whole PR diff in one pane, GitHub style, one card per file.
- A risk analysis first: Claude rates the change and each file, tells you which decisions need your judgment, and collapses the low-risk files.
- Draft comments from Claude, one per finding, in the pane for you to keep, edit, or delete.
- Your own comments on any line or range, and a way to ask Claude about a range.
- One command to turn the kept comments into a pending GitHub review.
- A memory of what you kept and deleted, fed back into the next review.

Nothing is approved or submitted automatically. The review stays pending until you submit it on GitHub.

## Requirements

- Claude Code 2.1.287 or later. The plugin is a mod; mods are on by default from that version.
- `git` on your path.
- `gh` on your path and logged in.
- A terminal 110 columns or wider docks the pane beside the transcript. Narrower puts it above the prompt. When the pane reopens by itself at session start on a terminal too narrow to seat it, it waits, and a toast says why.

## Install

In a Claude Code session:

```
/plugin marketplace add stefanoshea/diff-review
/plugin install diff-review@diff-review
/reload-plugins
```

A mod runs with your permissions. Read the code first: `claude plugin validate` on a clone lists every event it hooks and every call it makes.

To run it from a local clone instead:

```
claude --plugin-dir /path/to/diff-review
```

## Run it

Inside a clone of the repository that holds the pull request:

```
/diff-review 2148
/diff-review claude
```

Triage the drafts in the pane, add your own, then:

```
/diff-review send
```

Open the pull request on GitHub and submit the pending review.

## Commands

| Command | Effect |
|---|---|
| `/diff-review pr <number, URL or owner/repo#number>`, or just `/diff-review 2148` | Review a pull request without checking it out. Your branch and working tree stay untouched. In a fork clone the PR is fetched from the remote that matches the PR's repository. |
| `/diff-review` | Open the pane for the current branch against its base. If the pane is open, report its status. |
| `/diff-review branch` | Leave PR mode and go back to the current local branch. |
| `/diff-review risk` | Risk analysis only. Claude reads the diff and fills the risk card. |
| `/diff-review claude` | Full review: risk analysis, then the configured review skill, then one draft comment per finding. |
| `/diff-review send` | Create a pending review on GitHub from the open comments. |
| `/diff-review note <text>` | Store a standing preference for reviews in this repository, for example `note skip docstring nits`. |
| `/diff-review memory` | Print what the plugin has learned for this repository. `memory clear` deletes it. |
| `/diff-review refresh` | Refresh the diff and comments. |
| `/diff-review clear` | Delete the stored comments for the current branch or PR. |
| `/diff-review base <ref>` | Branch mode only: diff against this ref instead of the detected base. |
| `/diff-review close` | Close the pane. |

The pane reopens by itself on the next session in the same repository until you close it.

### A PR in another repository

A URL or an `owner/repo#number` names the repository, so a PR outside the clone you are sitting in works too: `gh` is asked for that repository, the diff comes from the GitHub API, and nothing is fetched into the local clone. Comments, risk and feedback memory are stored under `owner/repo`, not the working directory, and the pane header names the repository. Give a bare number and it still means a PR of the current repository.

Claude is told the PR lives elsewhere, so it reads the diff through the plugin's tools instead of local files. Sending still posts to the PR's own repository.

## The pane

Header, always visible: title, `branch → base @sha · n open`, and buttons `refresh`, `send`, `claude review`, `risk`, `files`, `sent`, `expand all`, `↑ comment`, `↓ comment`, and `base` in branch mode.

Body:

- The risk card, once an analysis has run. Coloured by level. It holds the summary, `needs judgment: …`, and `decisions for you` bullets. `[hide]` hides it; the `risk` button shows it again or runs a new analysis. It says `(stale: diff changed)` when the PR head moved since the analysis.
- One card per file, in risk order: high, unrated, low. The header carries the status, path, `+added -removed`, `●n` for open comments, and a risk badge `⚠ high`, `⚠ medium`, or `low`. Low-risk files start collapsed. Press a header to collapse or expand it.
- One row per diff line with a gutter button carrying the line number. `●` marks lines with comments.
- Comments in rounded boxes under their line: cyan for yours, magenta for Claude's, dim once sent. Each open comment has `edit` and `delete`.

Keys and buttons:

- Tab and the arrow keys move the focus ring over gutters and buttons. The body follows the ring. The mouse wheel scrolls.
- `ctrl+↑` / `ctrl+↓` (or `opt+↑` / `opt+↓`) step through the comments in diff order, centring each one and expanding its file if needed. The footer reads `comment 3 of 7`, and `(wrapped)` past the end.
- Enter on a gutter opens the comment field for that line. A second gutter in the same file and side extends the selection to a range, shown inverse.
- In the field: Enter or `[save]` stores the draft. A range inside one hunk is kept as a range: the box shows `lines a-b` and GitHub gets a multi-line comment. A range across hunks is stored on its first line. `[ask]` sends the selected lines and your text to Claude as a question. `[cancel]` discards.
- `[files]` shows a jump list. Press a file to expand it alone. `[expand all]` expands everything, low-risk files included. `[sent]` shows or hides sent comments.
- Esc hands keys back to the prompt. `ctrl+x x` closes the pane.
- Page Up, Page Down, Home and End do not reach the pane in this version. Left and Right cannot be bound to a pane.

## Claude's part

`/diff-review claude` runs three steps in order. Each step starts when Claude's turn for the step before it ends. If a turn ends by interruption, refusal or error, the chain stops and the footer says `claude review stopped: <step> ended (<reason>)`. Closing the pane also stops it.

1. Risk analysis. Claude reads the diff with `get_diff` and calls `set_risk` once: overall level, summary, review dimensions that need a human, up to five decisions for you, and a level per file.
2. The review skill. Default `/code-review low`, with the PR number appended in PR mode. Set another one in `/config` under `Review skill` (plugin option `reviewSkill`), or in `settings.json`:
   ```json
   { "pluginConfigs": { "diff-review": { "options": { "reviewSkill": "/my-team-review" } } } }
   ```
3. Drafts. Claude turns each finding into one `add_comment` call on the exact line. You triage them in the pane.

Tools the plugin gives Claude:

- `mcp__diff-review__get_diff` — the diff with `R<n>` (new file, side RIGHT) and `L<n>` (old file, side LEFT) line numbers. Optional `path` for one file in full.
- `mcp__diff-review__set_risk` — record the risk analysis: `level`, `summary`, `dimensions`, `decisions`, `files[{path, level, reason}]`.
- `mcp__diff-review__add_comment` — one draft on `path`, `line`, `side`, with `body`. Refused when the pane is closed or the line is not on the diff.
- `mcp__diff-review__list_comments` — the open drafts, grouped by file.

You can also just ask, with the pane open: "Look at the diff and add draft comments for anything risky."

## Feedback memory

The plugin keeps one memory per repository and adds it to the risk prompt and the review prompt:

- A Claude draft you delete is recorded as rejected, with its path and text.
- A Claude draft you edit is recorded as corrected, old and new text.
- A Claude draft you send is recorded as accepted.
- `/diff-review note <text>` records a preference in your words.

The prompt block lists your notes, the last 15 rejected drafts, the last 10 corrections, and the accepted count, capped in size. `/diff-review memory` shows it. `/diff-review memory clear` deletes it. The memory never approves anything by itself.

## Send

`/diff-review send` creates a pending review on the pull request through the GitHub API from the open comments. The review stays pending: you submit it on GitHub, where you can still edit or drop comments.

Send is blocked when:

- there is no pull request for the current branch (branch mode),
- your local HEAD is not pushed to the matching branch on `origin` (branch mode),
- a file with an open comment has uncommitted changes (branch mode; the pane diffs the working tree, but GitHub only knows the pushed commit),
- `gh` is not available or not logged in,
- an open comment is no longer on the diff.

In PR mode the review is posted against the PR head that the pane shows. Refresh first if the header says the diff changed.

## Storage

All state lives in the plugin store, per repository toplevel:

| Key | Holds |
|---|---|
| `review:<toplevel>:<branch>` | comments in branch mode |
| `review:<toplevel>:pr-<n>` | comments in PR mode |
| `risk:<toplevel>:<branch or pr-n>` | the risk analysis with the head sha |
| `memory:<toplevel>` | feedback memory |
| `base:<toplevel>:<branch>` | base override |
| `open:<toplevel>` | reopen marker with the PR number |

`/diff-review clear` deletes the current comment key only.

## Known limits in 0.1

- Sending has been unit tested against the GitHub review endpoint; run your first send on a PR where a stray pending review is harmless.
- `gh pr view` needs a default repository in clones with several GitHub remotes: `gh repo set-default`.
- Files over 200 KB of diff are listed but not expanded.
- `git diff` output over 4 MiB is cut. The footer names the last file kept, that file shows no hunks, and the files after it are missing. Claude's `get_diff` says the diff is incomplete.
- Existing GitHub review threads are not shown in the pane yet.

## Development

- `claude plugin test .` — run the test suite.
- `claude plugin validate .` — validate the plugin manifest and hooks.

## License

MIT. See `LICENSE`.
