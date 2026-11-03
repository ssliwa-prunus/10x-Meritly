---
name: 10x-ray
description: >
  Learn how a skill works by watching it run. Maps the target skill's anatomy
  (steps, loops, fan-outs, human gates, branches, and why each exists), runs
  the skill in a background subagent, and reveals the map concept by concept
  as the run reaches each step, ending with a full "skill anatomy". The
  skill's own questions are handed to the user exactly as the skill would ask
  them. Use when the user invokes /10x-ray <skill> [args], or asks to
  "x-ray", "watch", "trace", "visualize" or "understand" a skill by running
  it. `--mode html` shows the same view on a live page in the browser instead
  of the terminal.
argument-hint: "[--mode terminal|html] <skill-name> [args for that skill]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
  - Monitor
  - SendMessage
  - TaskStop
  - AskUserQuestion
---

# 10x-ray

You are the observer and the interpreter. You read the target skill and map
its anatomy, a background subagent (the worker) runs it and tags every event
with the map step it is in, and a Monitor turns that into concept-level
frames: "the skill now fans out sub-agents, and this is why". The user should
come away understanding the skill's design, not just having watched tool
calls scroll by. You also broker every question the skill puts to a human.

Script: `XRAY=<this skill's base directory>/scripts/xray.mjs`. The harness
prints the base directory when the skill loads ("Base directory for this
skill: …"); the skill may live in a project's `.claude/skills/` or in
`~/.claude/skills/`, so never derive it from the current repo. Use the
absolute path everywhere; the worker needs it too. Requires Node 18+.

## 1. Parse the invocation

- Leading `--mode <terminal|html>` (or `--mode=<…>`) picks where the view is
  shown; default `terminal`. Only a mode flag _before_ the skill name counts;
  anything after the skill name belongs to the skill.
- Next token = target skill name (strip a leading `/`). Everything after it
  = `ARGS` for that skill, passed through verbatim.
- No skill given: list a few skills from the available-skills list and ask
  which one to run. Stop there.
- The target must be in the available-skills list. If it isn't, say so and
  suggest the closest names. Refuse `10x-ray` itself as a target.
- `LANG` = the language the user writes to you in this conversation: `pl`
  for Polish, `en` for anything else. It sets every label the user sees, the
  language you write the map in, and the worker's narration.

## 2. Map the skill

Read `references/mapping-guide.md` (schema, patterns, how to write concepts)
and, the first time in a session, `references/example-map-10x-research.json`.
Then read the target's SKILL.md (`.claude/skills/<skill>/` or
`~/.claude/skills/<skill>/`) and the files it says to follow as part of its
workflow. Write the map to a scratch file and register it:

```bash
LOG=$(node "$XRAY" init <skill> "<ARGS>" --lang <LANG>)
node "$XRAY" map "$LOG" <map.json>      # validates; fix and rerun on error
node "$XRAY" emit "$LOG" start - "Worker launched: /<skill> <ARGS>"
```

Keep the map to yourself. Don't print it or describe the skill's steps in
chat: the user discovers them one by one as the run reaches them.

## 3. Start the views

**html mode only:** start the page server with Bash
`run_in_background: true`: `node "<XRAY>" serve "<LOG>"`. Read its output
for the `x-ray page: http://127.0.0.1:<port>/` line (it appears within a
second), then `open <url>`. The page (`assets/xray.html`) shows one card
per revealed step, with its concept, the live "now" line, notes and a
folded agent trace; lanes of a fan-out nest inside it. When the run ends, the
server writes a standalone snapshot next to the log (`<LOG>.html`).

Start a Monitor:

- `command`: `node "<XRAY>" watch "<LOG>"` in terminal mode,
  `node "<XRAY>" watch "<LOG>" --quiet` in html mode (absolute paths,
  already expanded). Quiet watch only wakes you for questions and the end of
  the run. Add `--verbose` only if the user asks to see every agent action.
- `description`: `x-ray of /<skill>`
- `timeout_ms`: `1800000`

`watch` remembers what it has already rendered, so re-arming never repeats a
frame.

## 4. Launch the worker

Read `references/worker-brief.md`, take everything below its `---` line and
fill `{{SKILL}}`, `{{ARGS}}`, `{{LANG}}`, `{{XRAY}}`, `{{LOG}}` and `{{NODES}}`. For
`{{NODES}}`, use one line per map node, `<id>  <pattern>  <title>`, with
children indented two spaces under their parent. Launch it with the Agent
tool: `subagent_type: "general-purpose"`, description `x-ray: /<skill>`. It
runs in the background. Note its agent ID for SendMessage.

Tell the user in one line that the x-ray is running (html mode: with the page
URL), then end your turn.

## 5. Relay loop

**terminal mode**, on every Monitor notification:

- The first line is an `x-ray tick …` status line, which the host already
  shows in its notification row. Drop it and output the rest verbatim inside
  a ` ```text ` fence. Notifications arrive HTML-escaped: turn `&amp;`
  `&lt;` `&gt;` back into `&` `<` `>`. Change nothing else. The frames
  carry the teaching (concept per step, notes for outcomes), so add at most
  one short line under the fence, only when a frame needs context the user
  can act on (e.g. a `WARNING`). Don't predict upcoming steps.
- Monitor expired and no anatomy frame yet: re-arm the same command.

**html mode:** don't print frames. Quiet ticks arrive only for questions
(handle them as below) and for the end of the run (print the anatomy frame
in a fence, then the result).

### Handing control to the user

When the skill asks something, the user gets the very same interaction it
would have shown. Act on the **Monitor event**, not the worker's completion.
When a tick line ends with `· ask=<payload file>`:

1. Relay the frames as usual (terminal mode).
2. `cat` the payload file and mimic the child exactly:
   - `"mode":"choice"`: call AskUserQuestion with the payload's `questions`
     array unchanged: same wording, headers, options, descriptions,
     `multiSelect`. Don't rephrase, merge or trim anything.
   - `"mode":"text"`: print the payload's `prompt` verbatim as your message,
     outside the fence, and end your turn. The user's next message is the
     answer.
3. Record the answer in the trace:
   `node "$XRAY" answer "$LOG" "<short form, e.g. Depth: Quick overview · Focus: Identity & sessions>"`.
4. Send it to the worker with SendMessage (its agent ID): for choices,
   `User answer:` then one line per question, `<header>: <chosen labels>`,
   plus any free text typed under Other or in notes; for text mode, the
   reply verbatim. If the worker's `NEEDS_INPUT` completion hasn't arrived
   yet, wait for it first so the message resumes the worker instead of
   landing mid-turn.
5. Re-arm the Monitor if it stopped meanwhile.

If AskUserQuestion is rejected or the user answers outside the options, pass
their words through as the answer. Don't re-ask. Don't print the worker's
`NEEDS_INPUT` completion message; it adds nothing beyond the payload.

### End of the run

On the worker's final completion notification (not `NEEDS_INPUT`):

- If the log has no `done`/`fail` event (worker crashed or forgot), emit one
  for it so the anatomy renders:
  `node "$XRAY" emit "$LOG" fail - "Worker ended without a final event" "<one-line reason>"`
  (`done` instead if the worker clearly succeeded).
- Relay the anatomy frame from the Monitor. It lists every mapped step,
  visited or not, so this is the moment the whole design is visible.
- html mode: stop the page server with TaskStop once its output shows the
  `x-ray snapshot:` line, and give the user the snapshot path.
- Give the skill's actual result from the worker's final message: files
  produced with paths, key findings or decisions, open follow-ups. Then, in
  2–4 sentences, the takeaway about the skill's design: the one or two ideas
  that make it work (e.g. "the cheap scope question before the expensive
  fan-out"). That is the point of the x-ray.

## 6. Stopping early

If the user asks to stop, stop the worker with TaskStop, then emit `fail`
with title `Stopped by user` (tagged with the current step). The Monitor
renders the anatomy and exits on its own (re-arm it first if it had
expired). Relay it and report what the worker had already changed on disk.
