---
name: 10x-plan
description: Create detailed implementation plans with thorough research and iteration
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Agent
  - Task
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

## Native question capability

First route the invocation: `/10x-plan <change-id> save` (also `$10x-plan <change-id> save`), or a request to save the already agreed plan after a mode switch, resumes **persistence**, not the interview. Read [references/plan-persistence.md](references/plan-persistence.md) and follow its save route before checking question prerequisites. A missing question tool is not a blocker when no decisions remain unresolved.

`AskUserQuestion` below means the current harness's real structured question tool: Claude Code `AskUserQuestion`, Codex `request_user_input`, or OpenCode `question`. Preserve question meaning and the recommendation/tradeoff format when mapping arguments; the actual native schema governs option count and field limits. Use fewer options or split independent questions when the host limit is tighter. Codex also requires a unique question `id` and does not expose `multiSelect`; use separate single-choice questions there when choices are independent. In OpenCode map `multiSelect` to `multiple`, keep single-choice questions at `multiple: false`, and preserve custom text input (`custom: true`).

Before the first question, check the tool actually available in the current session. In Codex CLI/app-server, native `request_user_input` requires **Plan collaboration mode**. Invoking this skill does not change the host's mode, and `codex exec` is not an interactive question entrypoint. The host/controller must start the interactive turn in Plan mode. In OpenCode, use a session whose native `question` tool has a connected question client (for example, its interactive terminal); an unattended text-only run is not evidence that the user can answer. If the required native tool is unavailable, name the missing capability and stop before assuming answers or creating the plan. Recommend switching to Plan collaboration mode specifically for Codex; for OpenCode, reconnect an interactive question client and resume the session. Do not claim a question was submitted when you only printed prose. An explicit noninteractive task that stops for missing prerequisites may still report those prerequisites without entering the interview.

Use the native tool's supported round size: Claude Code 1–4 questions; Codex guidance 1–3; OpenCode use at most 4 questions per round and respect any tighter native limit. The confirmed question budget is a **total across rounds**, not a requirement to squeeze all questions into the first call. Ask from the primary agent; research subagents do not conduct the user interview.

Check writing capability separately from questioning capability. When the host permits questions but forbids repository writes (including Codex Plan mode), read [references/plan-persistence.md](references/plan-persistence.md). Explain at the start that this session will produce the complete plan and brief in the conversation, followed by a Default-mode save step in the same conversation. A skill cannot switch host mode. Keep the latest decisions and corrections through that transition; do not restart the interview.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a file path or ticket reference was provided as a parameter, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **If no parameters provided**, respond with:

```
I'll help you create a detailed implementation plan. Let me start by understanding what we're building.

Please provide:
1. The task/ticket description (or reference to a ticket file)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous implementations

The more upstream context you pass in, the fewer questions I'll ask:
- Just a task description → full questioning
- Task + research doc (`context/changes/<change-id>/research.md`) → fewer questions; I won't redo what research covered
- Task + frame brief (`context/changes/<change-id>/frame.md`) → far fewer questions; the problem framing is already settled
- Task + frame + research → minimum questions; I focus only on solution-design decisions that need your input

Tip: invoke directly with a change-id or path — `/10x-plan oauth-login` or `/10x-plan @context/changes/oauth-login/frame.md`
For deeper analysis, try: `/10x-plan think deeply about @context/changes/oauth-login/research.md`
```

Then wait for the user's input.

## Process Steps

### Step 1: Context Gathering & Initial Analysis

#### Step 1.0: Identify upstream artifacts and scale questioning depth

Before any reading, identify what kinds of upstream artifacts the user passed in. Each one represents decisions already made — don't re-ask them.

- **Frame brief** — path matches `context/changes/<change-id>/frame.md`, or content begins with `# Frame Brief:` / contains a `## Reframed` section.
- **Research doc** — path matches `context/changes/<change-id>/research.md`, or YAML frontmatter contains `topic:` and `researcher:` fields.
- **Existing plan** — path matches `context/changes/<change-id>/plan.md` (resume/refine mode — out of scope for this scaling logic).
- **Task description only** — none of the above.

**Question count and focus scale with what's provided:**

| Upstream artifacts      | LOW | MEDIUM | HIGH  | What changes vs. baseline                                                                                                           |
| ----------------------- | --- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Task only (baseline)    | 4–6 | 7–10   | 11–15 | Full questioning across all relevant categories.                                                                                    |
| Task + research         | 3–5 | 5–7    | 8–11  | Skip questions whose answer is already in the research doc. Don't re-spawn sub-agents to find what research already mapped.         |
| Task + frame            | 2–3 | 4–6    | 7–9   | Skip [D]iagnostic categories — frame settled problem framing. Treat the Reframed (or Confirmed) Problem Statement as authoritative. |
| Task + frame + research | 1–2 | 3–5    | 5–7   | Skip both. Ask only [S]olution-design questions that genuinely need user input.                                                     |

**Settled-input exception:** if upstream artifacts already resolve every material solution decision, propose **0 substantive questions**, briefly identify that evidence, and obtain the usual native complexity/budget confirmation. Retain native structure approval. If an agreed budget becomes unnecessary after later answers, confirm the adjustment rather than padding questions. The ranges above guide unresolved work; they do not require invented decisions.

**Principle**: every artifact passed in is a source of decisions already made. Reading them counts as listening to the user. Don't ask the user what they already wrote down.

**When a frame is present**, read it FULLY and treat as authoritative:

- Copy the **Reported Observation** + **Reframed (or Confirmed) Problem Statement** as the task definition. Do not re-question the framing.
- Lift the **Hypothesis Investigation** table and **Narrowing Signals** into your "Current State Analysis" — this work is already done.
- If the frame **Confidence: LOW** is flagged, surface that in the plan's "Open Risks & Assumptions" and ask ONE clarifying question about how to proceed (verify first, or plan with risk acknowledged).
- Do NOT re-investigate the framing. Frame owns problem framing; you own solution design.

**When research is present**, read it FULLY and use as the codebase baseline:

- "Code References" section IS your codebase grounding — don't re-spawn Explore agents to find the same files.
- "Architecture Insights" feed directly into "Current State Analysis."
- Spawn sub-agents only to fill specific gaps research didn't cover (e.g., the exact files this plan will modify if research was broader).

#### Step 1.1: Read and research

1. **Read all mentioned files immediately and FULLY**:
   - Reference files (e.g., `context/changes/<change-id>/research.md`, `context/changes/<change-id>/frame.md`)
   - Research documents
   - Frame briefs
   - Related implementation plans
   - Any JSON/data files mentioned
   - `context/foundation/lessons.md` if present — treat its rules as priors when probing scope, edge cases, and architecture choices; rules already accepted by the team narrow which design pitfalls still need fresh questioning.
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Spawn parallel research before the interview**:
   Before asking the user any questions, delegate the unresolved evidence gaps to sub-agents working in parallel — by default 2–3 in a single message, each on a different search dimension (e.g. "find all files related to X", "find similar implementations of Y", "find prior decisions about Z in `context/changes/**/` and `context/archive/**/`"), each asked for `file:line` anchors. Read [references/task-orchestration.md](references/task-orchestration.md) before the first dispatch for the dispatch contract, capability fallback and evidence requirements. Resolve a single located fact with a scoped local read instead of a dispatch, and keep product questions and cross-component decisions with the primary agent. In Claude Code, dispatch with the `Agent` tool (`Task` in older Claude Code versions) — `subagent_type: "Explore"` for locating code, `"general-purpose"` for analysis; in other hosts use the native equivalent. Wait for all dispatched sub-agents to complete before integrating their results.

3. **Read all files identified by research tasks**:
   - After research tasks complete, read ALL files they identified as relevant
   - Read them FULLY into the main context
   - This ensures you have complete understanding before proceeding

4. **Analyze and verify understanding**:
   - Cross-reference the ticket requirements with actual code
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality
   - **Probe the words the request leaves undefined.** Ranking, selection and state terms — "top N", "latest", "first", "winner", "duplicate", "active", "until the end" — fix only what they literally say. For each, build the smallest case where two readings give different user-visible outcomes, then read what the code does there; a tiebreak it performs by id, insertion order or array position is not a decision anyone made, so it does not settle the term. Every term whose readings differ becomes a first-round question. See [references/question-examples.md](references/question-examples.md#undefined-terms-in-the-request) for how to build the case, phrase the option and record the outcome.

5. **Present informed understanding and assess complexity**:

   First, present a brief summary of what you found:

   ```
   Based on [the ticket and my research of the codebase / your description and my analysis], I understand we need to [accurate summary].

   I've found that:
   - [Key discovery — code reference, existing asset, prior work, or domain constraint]
   - [Relevant pattern, convention, or constraint discovered]
   - [Potential complexity or edge case identified]
   ```

   Then assess the task complexity and present it to the user for confirmation:

   ```
   **Complexity Assessment: [HIGH / MEDIUM / LOW]**

   [2-3 sentence explanation of WHY this complexity level, referencing specific factors:
   number of systems touched, integration points, state management needs,
   data model changes, unknown unknowns, testing surface area, etc.]

   I'd like to ask **[N] questions** across multiple rounds to nail down the important
   decisions about [list key decision areas: architecture, edge cases, data model, UX, testing, etc.].

   Does this feel right, or would you adjust the complexity level?
   ```

   Use AskUserQuestion for confirmation:
   - question: "Does this complexity assessment match your expectations?"
     header: "Complexity"
     options:
     - label: "⭐ Recommended: [N] questions (Recommended)"
       description: "Use the proposed question budget. · Strength: Focuses on identified decisions. · Tradeoff: Newly discovered gaps may require an adjustment."
     - label: "Higher — ask more questions"
       description: "Expand the interview with the missing concerns. · Strength: Covers additional risks. · Tradeoff: Requires more user time."
     - label: "Lower — fewer questions needed"
       description: "Reduce the interview to the remaining decisions. · Strength: Avoids redundant questions. · Tradeoff: Requires identifying which concerns are already settled."
       multiSelect: false

   **Complexity scale:**

   | Level      | Questions | When to use                                                                                                                                                                                                                                                                                                           |
   | ---------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **LOW**    | 4-6       | Straightforward task with clear requirements. Few moving parts, follows established patterns or conventions, limited unknowns. Software examples: single-file change, config tweak. Non-software examples: single-topic outline, simple process tweak.                                                                |
   | **MEDIUM** | 7-10      | Multiple components or considerations that interact. Requires design decisions, has edge cases worth discussing, some ambiguity in approach. Software examples: multi-file feature, new API endpoint. Non-software examples: multi-part content plan, workflow redesign, course module.                               |
   | **HIGH**   | 11-15     | Cross-cutting concerns, significant unknowns, many stakeholders or constraints. Requires architectural thinking, has risk of expensive rework if wrong. Software examples: system redesign, data migration. Non-software examples: multi-channel launch strategy, curriculum overhaul, organizational process change. |

   After the user confirms (or adjusts), proceed to questioning.

6. **Ask deep probing questions using AskUserQuestion**:

   Ask about the remaining decisions within the confirmed total budget, using the native round size above. The budget includes substantive clarifications; it is not a quota to fill or permission to reopen settled interfaces.

   **Rules for structuring questions:**
   - Each question should have 2–4 concrete options within the actual native schema; use 2–3 where that is the host limit
   - Use `multiSelect: true` only when choices aren't mutually exclusive
   - Keep `header` short (max 12 chars): "Scope", "Edge cases", "Priority"
   - The user can always choose "Other" for free-form input

   **Each question MUST have one recommendation; every option MUST include tradeoff analysis:**
   - Put exactly one recommended option **first**, with the exact label template `⭐ Recommended: [short choice] (Recommended)`. Keep the literal `⭐ Recommended` marker and the native `(Recommended)` suffix together; shorten the choice text, never abbreviate the marker to `⭐ Rec`. This satisfies both the skill format and native recommendation placement.
   - Each option's `description` must follow this format:
     `[1-sentence what this does] · Strength: [key advantage] · Tradeoff: [key cost or risk]`
   - The recommendation should be grounded in research (codebase patterns for software, domain knowledge and context for non-software) — not guessing

   **Check the payload before calling the tool:** every `header` is 1–12 characters (count spaces), each question has 2–4 distinct choices within the actual host limit, only the first label contains the exact `⭐ Recommended` marker, and every description contains both `· Strength:` and `· Tradeoff:` with concrete content. Use `Format` instead of the 13-character `Output format`. Verify the native call arguments themselves, not only a prose preview.

   **Example AskUserQuestion call with recommendations (software — delivery):** `Rollout` is `[S]` — delivery strategy; ask only when the change can fail in production in a way the release path would have to contain, otherwise inherit the team's default.

   AskUserQuestion with questions:
   - question: "How should the new pricing calculation reach production accounts?"
     header: "Rollout"
     options:
     - label: "⭐ Recommended: Flagged canary (Recommended)"
       description: "Ship behind a feature flag enabled for 10% of accounts first, then widen. · Strength: A wrong price hits a bounded group and reverts with a flag flip, no redeploy — reuses the flag wrapper already gating the checkout redesign. · Tradeoff: Both calculation paths stay live until cleanup, so pricing tests must cover each one."
     - label: "Ship to everyone at once"
       description: "Deploy the new calculation for all accounts in a single release. · Strength: One code path from day one — nothing to clean up and no flag bookkeeping. · Tradeoff: Rollback means a redeploy, and incorrect invoices have already reached customers."
     - label: "Shadow run first"
       description: "Compute old and new prices in parallel, log the differences, serve only the old result for two weeks. · Strength: Surfaces disagreements against real traffic with zero customer impact. · Tradeoff: Delays launch by the observation window and adds a diff log nobody owns yet."
       multiSelect: false

   **Example AskUserQuestion call with recommendations (software):** `Conflicts` is `[S]` — solution architecture; ask only if the decision remains unresolved after reading upstream artifacts.

   AskUserQuestion with questions:
   - question: "How should the system handle conflicts when two users edit simultaneously?"
     header: "Conflicts"
     options:
     - label: "⭐ Recommended: Guided merge (Recommended)"
       description: "Show conflict to user, let them choose which version to keep. · Strength: Prevents data loss while keeping UX simple — matches the pattern in existing EditPanel component. · Tradeoff: Adds a conflict resolution modal and WebSocket subscription for real-time detection."
     - label: "Last write wins"
       description: "Later save silently overwrites earlier one. · Strength: Zero added complexity, no UI changes needed. · Tradeoff: Users can lose work without warning — acceptable only if edits are rare or low-stakes."
     - label: "Lock-based"
       description: "First editor locks the resource; others see read-only until released. · Strength: Prevents conflicts entirely — simplest mental model for users. · Tradeoff: Stale locks require TTL + cleanup logic; blocks legitimate concurrent work."
       multiSelect: false

   **Example AskUserQuestion call with recommendations (non-software — content/strategy):** `Depth` is `[D]` — diagnostic about audience/scope; skip if a frame brief already settled who this is for.

   AskUserQuestion with questions:
   - question: "What depth of technical detail should the course module target?"
     header: "Depth"
     options:
     - label: "⭐ Recommended: Guided practice (Recommended)"
       description: "Concepts paired with step-by-step exercises. · Strength: Balances understanding and practice — matches the format that got highest completion rates in 10xDevs2. · Tradeoff: 2-3x more prep time per lesson; requires working example repos."
     - label: "Conceptual overview"
       description: "High-level principles, no code. · Strength: Accessible to all skill levels, faster to produce. · Tradeoff: Advanced learners may find it too shallow — risks losing engagement."
     - label: "Deep dive with open challenges"
       description: "Minimal scaffolding, real-world problems. · Strength: Forces genuine problem-solving, highest learning retention. · Tradeoff: High dropout risk for less experienced learners; harder to support at scale."
       multiSelect: false

   **What to ask about** — adapt categories to the domain of the task:

   First, identify the task domain: **software**, **content/education**, **strategy/process**, or **hybrid**. Then pick question categories that fit. The categories below are organized by domain — select what's relevant, don't force software categories onto non-software tasks.

   **Each category is tagged `[D]` (diagnostic — about the problem) or `[S]` (solution — about how to build it).** When a frame brief was provided in Step 1.0, **skip all `[D]` categories** — frame settled them. Always ask `[S]` categories the user input still needs to drive.

   **Universal categories (all domains, all levels):**
   - **Scope boundaries** `[D]`: What's in vs out
   - **Edge cases / failure modes** `[S]`: What happens when things go wrong or get weird (implementation handling, even if a frame named the observation class). Start from the undefined terms surfaced in Step 1.1 — put the concrete case in the question rather than naming the category
   - **Success criteria** `[D]`: How do we know this worked — from the end user's or stakeholder's perspective
   - **Priority** `[D]`: Must-have vs nice-to-have — what gets cut if time is tight

   **Software-specific categories (add based on complexity):**

   MEDIUM+:
   - **Data model decisions** `[S]`: Schema, relationships, constraints, migrations
   - **Error handling strategy** `[S]`: Failure modes, retry logic, user-facing messages
   - **Testing approach** `[S]`: Coverage level, which edge cases to test explicitly
   - **Performance boundaries** `[S]`: Expected load, acceptable latency, caching

   HIGH:
   - **Architecture choices** `[S]`: Service boundaries, sync vs async, event-driven vs request-response
   - **State management** `[S]`: Where state lives, consistency guarantees, conflict resolution
   - **Security model** `[S]`: Auth boundaries, data access, input validation
   - **Migration & rollback** `[S]`: Incremental deployment, revert strategy
   - **Observability** `[S]`: Key metrics, alerting, debugging surface

   **Content / education categories (add based on complexity):**

   MEDIUM+:
   - **Audience & prerequisites** `[D]`: Who is this for, what do they already know
   - **Format & medium** `[S]`: Written, video, interactive, live — and why
   - **Narrative arc** `[S]`: What journey does the reader/learner go on
   - **Examples & exercises** `[S]`: What makes concepts stick

   HIGH:
   - **Curriculum dependencies** `[D]`: What must be learned before what
   - **Assessment strategy** `[S]`: How to verify learning happened
   - **Reuse & modularity** `[S]`: Can parts be used standalone or in other contexts
   - **Distribution & access** `[D]`: Where does this live, how do people find it

   **Strategy / process categories (add based on complexity):**

   MEDIUM+:
   - **Stakeholders & roles** `[D]`: Who's involved, who decides, who executes
   - **Timeline & milestones** `[S]`: Key dates, dependencies, critical path
   - **Risk identification** `[S]`: What could go wrong, what's the fallback
   - **Resource constraints** `[D]`: Budget, time, people, tools

   HIGH:
   - **Change management** `[S]`: How do affected people learn about and adopt this
   - **Measurement framework** `[D]`: Leading vs lagging indicators, how to course-correct
   - **Dependencies & sequencing** `[S]`: What blocks what, what can run in parallel
   - **Communication plan** `[S]`: Who needs to know what, when, through which channel

   **What NOT to ask about:**
   - Anything already settled in upstream artifacts (frame brief, research doc) — re-asking is the failure mode this scaling is designed to prevent
   - Low-level implementation details you can determine yourself (from codebase research for software, from context files and prior work for non-software)
   - Questions with obvious answers given the context already provided
   - Preferences that don't affect the plan's structure or success

   Use Step 1.0 to propose a budget appropriate to complexity and upstream evidence. Cover every material unresolved decision within the user-confirmed budget; if needed, request an extension before asking another substantive question. Do not pad the interview or reopen settled choices to meet a suggested range. Each question should resolve a real gap.

   Keep an internal record of unresolved user decisions and the latest explicit answer for each. A partial answer or “I do not know” leaves that decision open unless the user explicitly delegates the choice. A mechanism already present in the code does not settle an unresolved product choice about how it should be used. Corrections replace the earlier decision while preserving the other answers.

   Before presenting the approach, check that each unresolved decision has an answer or an explicit delegation. The agreed question budget includes clarification rounds; do not fill it with new topics while earlier answers still need clarification. If the budget runs out with a decision open, state what remains and ask whether to extend the interview rather than silently choosing or claiming the interview is complete.

   Carry exact decision predicates into summaries, examples and deliverables. Preserve boundaries, exceptions, units and direction when shortening an answer; a narrower or broader rule is a new decision. Check the proposed wording against a boundary case. On correction, update dependent examples and the brief as well as the decision record, keeping unrelated choices settled.

### Step 2: Research & Discovery

After getting initial clarifications from the user, NOW is when you address the implementation details:

1. **Research implementation patterns and prior work**:
   During this phase, answer implementation questions yourself — don't ask the user to make these decisions.

   **For software tasks**, research the codebase:
   - What patterns does the codebase use for similar features?
   - What's the established error handling / logging / testing approach?
   - Which existing components or utilities can be reused?
   - What constraints does the current architecture impose?

   **For non-software tasks**, research context files and prior work:
   - What formats, structures, or templates were used for similar work before?
   - What constraints exist from prior decisions, audience, or platform?
   - What related content or processes already exist that this should align with?
   - What worked well (or didn't) in previous iterations?

   **This is NOT for users to decide** — you determine this by researching existing patterns, files, and context.

2. **If the user corrects any misunderstanding**:
   - Accept changed preferences as the latest user decision; do not demand source proof for a preference.
   - Verify corrected factual claims in the named source; delegate only if an independent investigation is useful
   - Read the affected files or sections, retaining unrelated verified findings
   - Only proceed once you've verified the facts yourself

3. **Update the unresolved questions and owners**:
   Reuse the working list from Step 1. Track multi-area work with native task tools if available; no extra tracking ceremony is needed for one lookup.

4. **Investigate only the remaining gaps**:
   Apply the orchestration reference for scoped dispatch, available model choices, launch failures and stale results. Independent tasks may run concurrently; dependent tasks wait for their prerequisite. Reuse the existing worker for a focused follow-up.

5. **Close discovery at the evidence boundary**:
   Synthesize results as they arrive; verify consequential claims and resolve material conflicts. Stop when you can explain the affected contracts, reusable patterns, verification and remaining user decisions. Cancel irrelevant exploration. Unfinished required checks remain blocking; do not replace evidence with a time budget.

6. **Present findings and design options using AskUserQuestion**:

   First, present a brief summary of research findings:

   ```
   Based on my research, here's what I found:

   **Current State:**
   - [Key discovery about existing code]
   - [Pattern or convention to follow]
   ```

   Check approaches against settled requirements before offering them. Reject options that drop required guarantees; do not invent alternatives to fill a quota. Distinguish user decisions from missing evidence and implementation details the agent can derive.

   Then, if there are multiple valid approaches, present them as structured choices using AskUserQuestion:

   AskUserQuestion:
   - question: "Which implementation approach should we use?"
     header: "Approach"
     options:
     - label: "⭐ Recommended: [Option A] (Recommended)"
       description: "[What A does]. · Strength: [Evidence-backed advantage]. · Tradeoff: [Concrete cost or limitation]."
     - label: "[Option B name]"
       description: "[What B does]. · Strength: [Evidence-backed advantage]. · Tradeoff: [Concrete cost or limitation]."

   If there's clearly one best approach, skip AskUserQuestion and explain why you chose it.
   Only ask when the choice genuinely matters and you can't determine the answer from codebase patterns.

### Step 3: Plan Structure Development

Once aligned on approach:

1. **Present plan outline and get structured feedback**:

   First, print the proposed phases as text (informational):

   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
   2. [Phase name] - [what it accomplishes]
   3. [Phase name] - [what it accomplishes]
   ```

   Then use AskUserQuestion:
   - question: "Does this phase breakdown look right?"
     header: "Phases"
     options:
     - label: "⭐ Recommended: Approve phases (Recommended)"
       description: "Write the detailed plan with these phases. · Strength: Uses the reviewed structure. · Tradeoff: Later scope changes require revisiting it."
     - label: "Needs adjustment"
       description: "Revise the phase scope or ordering. · Strength: Addresses missing constraints now. · Tradeoff: Adds a planning round."
     - label: "Too granular"
       description: "Combine phases into larger units. · Strength: Reduces coordination overhead. · Tradeoff: Each verification step covers more work."
       multiSelect: false

### Step 4: Detailed Plan Writing

After structure approval:

If repository writes are forbidden, prepare the full plan using [references/plan-templates.md](references/plan-templates.md) and the Step 4.5 brief **in the conversation**, then issue the persistence handoff from `references/plan-persistence.md`. Do not create folders, update metadata, write a draft elsewhere, or delegate writes to bypass the host restriction. This is `awaiting_persistence`, not a saved or completed plan. A writable host follows the normal path below directly.

1. **Resolve the change folder, then write the plan** to `context/changes/<change-id>/plan.md`.
   - If the user invoked `/10x-plan <change-id>` and `context/changes/<change-id>/` already exists, use it.
   - Otherwise derive a kebab-case `<change-id>` from the topic and create the folder + `change.md` (mirroring `/10x-new` semantics) before writing.
   - Refuse if the resolved path starts with `context/archive/` — print: "This change is archived. Open a new change with `/10x-new` instead." and STOP.
   - After both plan and brief are written and verified, advance only `new`/`preparing` to `planned` and set `updated: <today>`; preserve identity, unrelated metadata and later lifecycle states. Use the bounded metadata helper/fallback in [plan-persistence.md](references/plan-persistence.md#reuse-the-metadata-helper).
   - **Sync the roadmap** (best effort): if `context/foundation/roadmap.md` carries an item whose `Change ID` equals `<change-id>`, flip that item to `Status: planning`. See "## Roadmap status sync" below. Never blocks; most changes won't trace to a roadmap.
2. **Read [references/plan-templates.md](references/plan-templates.md) now and use its full-plan structure.** Phase blocks contain plain bullets — `- ` not `- [ ]` — and a single canonical `## Progress` section at the bottom owns checkbox state; see `references/progress-format.md`. Do not load artifact templates during discovery just to prepare for later writing.

The Progress section is mechanical — emit one `### Phase N: <name>` per phase, with `#### Automated` / `#### Manual` subsections enumerating every Success Criteria bullet from that phase as `- [ ] <phase>.<index> <title>`. Omit empty subsections. The Phase blocks themselves carry plain `- ` bullets (no checkboxes); the `## Progress` section is the only place `[ ]` / `[x]` appear.

### Step 4.5: Plan Brief (Two-Pager)

After writing the full plan, generate a concise brief that gives the reader the high-level picture before they dive into the detailed plan. The brief is the first thing the user reads — it should take under 2 minutes and leave them with a clear mental model of what the plan does, why, and what the key decisions were.

1. **Write the brief** to `context/changes/<change-id>/plan-brief.md` (sibling of `plan.md` in the same change folder).

2. **Use the brief template in [references/plan-templates.md](references/plan-templates.md)**:

3. **Key principles for the brief**:
   - It must fit on roughly 2 printed pages (~60-80 lines of markdown). If you're going longer, cut.
   - The "Key Decisions" table is the heart — it surfaces what was decided during questioning so anyone reading the plan later understands the choices without re-reading all the questions.
   - "Starting Point" grounds the reader in what exists today — without it, someone unfamiliar with the project can't understand the delta.
   - "Prerequisites & Estimated effort" at the bottom of the Phases table gives the reader a quick feasibility check before committing to read the full plan.
   - Write for someone who wasn't part of the planning conversation — they should understand the plan's shape and rationale from the brief alone.
   - Link to the full plan at the top so the reader can dive deeper on any section.
   - Derive the brief from the same latest decision record as the plan. During the existing review pass, compare claims, numbers, examples and exclusions across both; correct contradictions before persistence. For each changed parameter, regenerate affected literal examples and expected outputs from that parameter; do not retain a previous expected string while only updating the decision table. Check required sections, including References, against the template already loaded. A structurally valid table does not establish agreement with its surrounding prose.

### Step 5: Sync and Review

On `$10x-plan <change-id> save` (and the persistence route in [plan-persistence.md](references/plan-persistence.md)), **skip this section**. That route already owns one preflight `inspect`, one write, one verification pass and one `mark-planned`. Do not add a second read-back, a second helper run, or a homemade Markdown validator.

1. **Confirm the plan + brief landed in the change folder** (writable in-session planning only; not the save route):
   - `ls context/changes/<change-id>/plan.md context/changes/<change-id>/plan-brief.md` should both exist.
   - Read the persisted content back once. Verify latest decisions and corrections agree across the documents, required plan/brief sections are present, and every phase's Success Criteria maps one-to-one to a canonical Progress row. Only new planning rows must be unchecked; repeated saves preserve existing execution Progress and later lifecycle status under the persistence route. Preserve unrelated metadata. Mechanical checks may read full files while returning only counts, hashes and actionable errors; inspect semantic content against the agreed plan. Do not repeatedly echo all three documents. Only report completion after these checks; file existence alone is insufficient.

2. **Copy quick start command to clipboard**:
   - After writing the plan, copy the implementation command to clipboard:

   ```bash
   echo -n "/10x-implement <change-id> phase 1" | pbcopy 2>/dev/null || echo -n "/10x-implement <change-id> phase 1" | clip.exe 2>/dev/null || echo -n "/10x-implement <change-id> phase 1" | xclip -selection clipboard 2>/dev/null || true
   ```

   ```powershell
   # PowerShell (Windows)
   Set-Clipboard "/10x-implement <change-id> phase 1"
   ```

3. **Present both the brief and full plan**:

   ```
   I've created the implementation plan:

   📋 Brief (start here): `context/changes/<change-id>/plan-brief.md`
   📄 Full plan: `context/changes/<change-id>/plan.md`

   → /10x-implement <change-id> phase 1 (✓ copied)

   Review the brief first, then check the full plan for anything that needs adjustment:
   - Are the phases properly scoped?
   - Are the success criteria specific enough?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?
   ```

4. **Iterate based on feedback** - be ready to:
   - Add missing phases
   - Adjust technical approach
   - Clarify success criteria (both automated and manual)
   - Add/remove scope items

5. **Continue refining** until the user is satisfied

## Roadmap status sync

`context/foundation/roadmap.md` (produced by `/10x-roadmap`) indexes each Foundation/Slice by a stable **Change ID**. As planning turns a roadmap item into a concrete change folder + plan, mark that item **`planning`** so the roadmap reflects that the item has left the backlog and entered active work. `/10x-implement` later advances the same item to `in-progress`, and `/10x-archive` closes it to `done`.

Do this in Step 4 (right after the `change.md` → `planned` stamp). The lookup is **mandatory**; "best effort" scopes only the _edits_ — a missing roadmap or a not-found target is skipped silently and never blocks, prompts, or aborts the run. Do not skip the check on the assumption there's no roadmap.

1. `test -f context/foundation/roadmap.md`. If absent, skip this step silently.
2. Read the file. Look for `<change-id>` used as a `Change ID`:
   - in the `## At a glance` table — the row whose **Change ID** column cell equals `<change-id>` exactly;
   - and in the `## Foundations` / `## Slices` bodies — the `### <ID>: …` block that contains a `- **Change ID:** <change-id>` line.

   Match is exact-string only. **No match** → print `ℹ context/foundation/roadmap.md has no item with Change ID "<change-id>" — roadmap left untouched.` and stop here.

3. **Match found** → if the item's `- **Status:**` is already `planning`, `in-progress`, or `done`, leave it untouched (**forward-only**: never regress a more-advanced status) and stop. Otherwise apply both edits with the Edit tool — each independent and best effort; skip a sub-edit whose target isn't where the `/10x-roadmap` template puts it, and note the skip. Touch only the `Status` field:
   1. **`## At a glance`** — set the matched row's **Status** cell to `planning`.
   2. **Item body** — rewrite the item's `- **Status:**` line to `- **Status:** planning`.

   Then bump the roadmap frontmatter `updated:` to `<today>` (skip if there is no frontmatter).

4. `/10x-plan` does not commit its own artifacts; leave the flip in the working tree. It is committed later alongside the change's first `/10x-implement` phase (which re-flips the same item to `in-progress`).

## Important Guidelines

1. **Be Skeptical**:
   - Question vague requirements
   - Identify potential issues early
   - Ask "why" and "what about"
   - Don't assume - verify with code, files, or context

2. **Be Interactive**:
   - Don't write the full plan in one shot
   - Get buy-in at each major step
   - Allow course corrections
   - Work collaboratively

3. **Be Thorough**:
   - Read all context files COMPLETELY before planning
   - Research unresolved patterns locally or through scoped independent tasks using the orchestration reference
   - Include specific references (file:line for code, document paths for content)
   - Write measurable success criteria with clear automated vs manual distinction

4. **Be Practical**:
   - Focus on incremental, testable changes
   - Consider migration and rollback
   - Think about edge cases
   - Include "what we're NOT doing"

5. **Track Progress**:
   - Reuse the unresolved-question list; native task tools are optional and host-dependent
   - Mark completed, blocked and cancelled work accurately; avoid bookkeeping for a single lookup

6. **MANDATORY: Complexity-Scaled Deep Questioning via AskUserQuestion**:
   - **BEFORE** writing any plan, you MUST assess complexity (HIGH/MEDIUM/LOW) and get user confirmation
   - Use Step 1.0 upstream scaling, its settled-input exception and the user-confirmed total question budget; the task-only ranges do not override accepted upstream decisions
   - Each question must put one `⭐ Recommended: [short choice] (Recommended)` pick first; every option needs the exact Strength/Tradeoff description format and a header of at most 12 characters
   - Cover scope, edge cases, architecture, data model, testing, and performance as relevant to complexity
   - Ask in native-supported rounds (Claude 1–4, Codex guidance 1–3) within the confirmed total budget; extend it explicitly only for unresolved decisions
   - Preserve the confirmed interview and native structure approval. Adjust the budget with the user when scope changes; never repeat settled questions merely to fill a baseline range
   - Wait for user answers before proceeding to detailed planning

7. **No Open Questions in Final Plan**:
   - If you encounter open questions during planning, STOP
   - Research or ask for clarification immediately
   - Do NOT write the plan with unresolved questions
   - The implementation plan must be complete and actionable
   - Every decision must be made before finalizing the plan
   - A term the user decided lands in sections that already exist — a named test or success criterion when accepted, "What We're NOT Doing" when declined. No new section for it
   - "Critical Implementation Details" subsections are opt-in: include them only when a real constraint, gotcha, or ordering requirement applies. Default to omission. A plan without that section is not incomplete.

8. **Describe intent, not implementation**:
   - The plan tells the implementer **what to change and why**, not how to write the code
   - Each change entry under `### Changes Required:` separates `**Intent**` (what and why) from `**Contract**` (the interface, signature, schema field, route, structure, or invariant the change touches). Code snippets, when needed, live at the tail of `**Contract**`
   - Default to no code snippets. Include a snippet ONLY when the change is non-obvious (tricky regex, unusual API call, counterintuitive ordering, workaround, signature contract that other phases depend on)
   - For routine edits — adding a field, wiring a handler, following an existing pattern — describe the `**Intent**` in 1-2 sentences, name the `**Contract**` in one, and stop. The implementer (human or agent) figures out the code from the file path, the surrounding pattern, and the intent
   - File paths and short Intent/Contract descriptions are usually enough. Resist the urge to pre-write the code

## Success Criteria Guidelines

**Always separate success criteria into two categories:**

1. **Automated Verification** — commands agents can run: `make test`, `npm run lint`, type checks, specific file existence
2. **Manual Verification** — human testing: UI/UX, real-world performance, edge cases, user acceptance

Each phase's success criteria use plain `- ` bullets under `#### Automated Verification:` and `#### Manual Verification:` headings. Copy each criterion exactly once to the canonical `## Progress` section as an unchecked numbered row; Progress is the only place for execution checkboxes.

## Common Patterns

- **Database changes**: schema/migration → store methods → business logic → API → clients
- **New features**: research patterns → data model → backend → API → UI
- **Refactoring**: document behavior → incremental changes → backwards compatibility → migration

## Task coordination

The [orchestration reference](references/task-orchestration.md) governs task selection, dispatch, model capability fallback, evidence review and stopping. It does not replace native questions, structure approval or the mode-aware save route. Do not invoke an implementation model recommender merely to finish research or save an agreed plan.

- **Spawn multiple sub-agents in parallel** in a single message — 2–3 for the research phase — rather than one after another.
- **Keep each task focused** on a specific area, with detailed instructions (directories, what to extract, expected format).
- **Request specific `file:line` references** in responses.
- **Wait for all dispatched sub-agents to complete** before synthesizing findings.
- **Verify sub-agent results** — if a finding is unexpected, dispatch a follow-up and cross-check it against the actual code.

## Context Management

Planning can be context-heavy due to research + iteration. Keep context efficient:

- **Delegate research to sub-agents** — they return summaries, keeping the main context lean. Don't re-read files that sub-agents already analyzed unless you need to verify specific details.
- **Synthesize, don't accumulate** — after sub-agents return, synthesize findings into your understanding rather than quoting large blocks verbatim.
- **If context feels degraded during planning** — if responses become sluggish or repetitive, save the current plan draft to file and offer the user to continue in a fresh context:
  Only do this when the host permits repository writes. In a read-only planning mode, use the conversation handoff from `references/plan-persistence.md`; do not claim a draft was saved or promise that a new conversation can recover unavailable decisions.
  ```
  The plan draft is saved at: context/changes/<change-id>/plan.md
  Would you like to continue refining in a fresh window?
  → /10x-plan <change-id> (✓ copied)
  ```
  This lets `/10x-plan` reload the draft and continue iterating with full context available.

## Additional question examples

If a feature-specific question is difficult to formulate, consult [references/question-examples.md](references/question-examples.md). The question format and upstream scaling above remain authoritative; examples do not establish measured performance benefits.
