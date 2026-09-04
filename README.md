# AgentWatch

> **AgentWatch is the glass box for your Claude agent workflows.**
>
> They run invisible in the terminal — AgentWatch makes every step visible, so you can trace it, fix it, and improve it.

A self-hosted web application for visualizing and debugging Claude Code multi-agent sessions.

---

## Why AgentWatch

### AI work is now a *team effort*, not a single prompt

Modern AI-assisted tasks — such as "analyse this ticket and produce a deliverable" — are no longer handled by one big prompt. They are broken into a **pipeline of specialised agents**, because that produces more accurate and maintainable results:

```
Developer submits a task
        │
  ┌─────▼─────┐
  │Orchestrator│ (the "manager" agent)
  └─────┬─────┘
   ┌─────────┼─────────┬──────────┐
   ▼         ▼         ▼          ▼
Requirements Context Processing Drafting
 Analysis   Gathering   Agent     Agent
  Agent      Agent               │
                                  ▼
                            Review Agent
                                  │
                                  ▼
                            Final Output
```

Each agent handles one concern and hands its work to the next. The result is better quality — but also a chain of **many hidden contributors** behind every output.

### The terminal hides the story

All of this runs as a wall of scrolling terminal text: hundreds of messages, many agents, intermediate files, tool calls, and long reasoning chains.

The information **exists** in those logs — but it is nearly impossible to consume. Even simple questions become hard to answer:

- *Which agent made this decision?*
- *Which piece of information led to this output?*
- *Where did this mistake actually start?*
- *Which agent should we improve?*

### The feedback problem

Imagine the final output is wrong. The natural reaction is to "give Claude feedback." But the reviewer only sees the **final result** — not which agent introduced the error.

So the feedback comes out generic:

> *"The output is wrong. Please improve the skill."*

The AI then **guesses** where to apply the fix — and often guesses wrong. The real cause might have been the Context Gathering Agent, but the fix lands somewhere else. Repeated over weeks, this creates **workflow drift**: the workflow keeps changing based on inaccurate feedback, slowly getting worse instead of better.

> **You cannot improve what you cannot see — and you cannot give good feedback on what you do not understand.**

---

## Who AgentWatch helps

| Audience | What they get |
| --- | --- |
| **Developers / engineers** | Stop scrolling terminals; pinpoint and fix the real cause fast |
| **Reviewers / QA** | Trace outputs to their source; give feedback that actually lands |
| **Team leads** | See how workflows evolve; trust that improvements are evidence-based |
| **The organisation** | Reliable, continuously-improving AI workflows instead of silent drift |

---

## The insight

The fix is not better prompting. It is **better visibility**.

Once you can observe a workflow properly, a natural progression appears:

| Step | What it unlocks |
| --- | --- |
| **Observability** — see what happened | You understand the run |
| **Targeted feedback** — point at the real cause | The right thing gets fixed |
| **Continuous improvement** — evidence-based fixes | The workflow gets better |
| **Self-healing** — the workflow analyses itself | Improvement happens automatically |

AgentWatch is built to support all four steps (self-healing in progress).

---

## How AgentWatch works

### It reads what Claude already records

While working with Claude Code, we found that **everything is already stored locally** on the machine, under a hidden `.claude` folder — every project, session, agent, message, artifact, and piece of metadata.

Nothing extra needs to be instrumented or logged. The raw truth is already there; it is just unreadable in its raw form.

```
.claude (raw local data)  →  AgentWatch (makes sense of it)  →  Your Browser
```

AgentWatch reads what Claude already records and builds a clear, human-friendly layer on top of it. Because it reads the **actual recorded session**, it always shows **what really happened at that point in time** — not a guess, and not today's version of the workflow. Historical runs stay faithful even after the underlying skills or agents are later edited.

### Integration with Claude Code

AgentWatch does not just read from Claude Code — it integrates with Claude Code's native features to provide a seamless browser-based experience:

| Integration point | What it does |
| --- | --- |
| **Session resume** | Improvement cycles resume the original Claude Code session (`--resume`), giving the improvement agent full context from the original run |
| **PreToolUse hooks** | An HTTP hook routes Edit/Write permission requests to the browser UI instead of the terminal |
| **Directory access** | Cross-project skill directories are granted read access via `--add-dir` |
| **Stream protocol** | Real-time progress is delivered via Claude Code's `stream-json` output format, displayed live in the browser |
| **Model selection & cancellation** | Execution Analysis, Skill Analysis, and Apply Improvements each let you pick the model (`--model haiku/sonnet/opus`) and stop the run mid-flight; the CLI's own reported model confirms the choice actually took effect rather than silently falling back to a default |

This means the entire improvement workflow — from feedback to analysis to file edits to approval — happens in the browser. The terminal is only needed to *run* the original workflow.

### Browser-based permission handling

In a standard terminal session, Claude Code is interactive. When the AI decides it needs to edit a file, it pauses and shows a permission prompt. AgentWatch runs Claude Code **programmatically and headlessly** (no terminal), so this terminal prompt is not available.

Rather than bypassing Claude Code's permission system, AgentWatch plugs into it using Claude Code's official **PreToolUse hook API**. The hook intercepts a tool call before it executes and delegates the approval decision to the browser.

```
Claude Code attempts Edit/Write
        │
  PreToolUse hook fires
        │
  HTTP POST → AgentWatch server
        │
  WebSocket broadcast → Browser
        │
  User sees diff preview → Clicks Approve or Deny
        │
  Decision flows back: Browser → WebSocket → Hook → Claude Code
        │
  Claude Code applies the edit itself (on approval)
```

| Aspect | Terminal | AgentWatch (Browser) |
| --- | --- | --- |
| **Where the prompt appears** | Terminal (text) | Browser (visual card with diff) |
| **How the user responds** | Types `y` or `n` | Clicks Approve or Deny |
| **Who applies the edit** | Claude Code | Claude Code (same) |
| **Headless compatible** | No — auto-denies | Yes — hook routes to browser |

AgentWatch does not bypass, replace, or reimplement Claude Code's permission system. It uses the **official hook API** to relocate the human-in-the-loop from the terminal to the browser.

---

## How AgentWatch differs from general observability tools

Tools like LangSmith, LangFuse, and Weave are built for developers who are building agentic applications. They work by integrating an SDK into application code — you wrap your LLM calls, add decorators, or route traffic through their platform as part of the development process. The target user is an engineer writing the agent code; the goal is to debug and evaluate it while building.

AgentWatch solves a different problem entirely. It is not a developer instrumentation tool. It is an observation and improvement platform for people who are running Claude Code workflows — developers, reviewers, and team leads who use Claude Code's skills and agents to do work, and want to understand what happened, give precise feedback, and make the workflows better over time.

| | LangSmith / LangFuse / Weave | AgentWatch |
| --- | --- | --- |
| **Primary audience** | Developers building agent applications | Anyone running Claude Code workflows |
| **When you use it** | During development, while writing agent code | After a workflow run, to observe and improve it |
| **How it works** | SDK integration — you instrument your code | Zero instrumentation — reads what Claude Code already writes to disk |
| **What it observes** | LLM calls you explicitly wrap | Every agent, message, tool call, artifact, and reasoning chain — retroactively |
| **Improvement loop** | Evaluation and debugging | Feedback → targeted fix → per-edit approval → rerun → compare |
| **Awareness of Claude Code concepts** | None | Native — understands skills, agents, sessions, improvement cycles, hooks |

---

## Tech stack

| Layer | What it is |
| --- | --- |
| **Framework** | Next.js (App Router) + React, TypeScript |
| **Data store** | SQLite (`better-sqlite3`) — a local file, no external database or server to stand up |
| **Real-time** | WebSocket (`ws`) — pushes live analysis and approval events to the browser |
| **Runtime** | Node.js 22+ |

AgentWatch is **self-hosted** — no cloud, no account, no upload. It runs on your machine and reads your local `~/.claude` folder directly.

---

## Getting started

**Clone the repository:**

```bash
git clone https://github.com/makum07/agent-watch-application.git
cd agent-watch-application
```

**Prerequisites:** Node.js 22+ and npm.

**Step 1 — Install and start**

```bash
npm install
npm run dev:server
```

(`npm run aw` is a shorter alias for the same command.)

By default AgentWatch auto-detects your Claude data at `~/.claude` (macOS/Linux) or `%USERPROFILE%\.claude` (Windows) — no configuration needed for a standard install.

**Step 2 — (Optional) Point to a non-standard Claude data path**

If your `.claude` folder lives somewhere else, copy the example file:

```bash
cp .env.local.example .env.local
```

Then edit `.env.local` and set `CLAUDE_HOME`:

```env
# macOS / Linux
CLAUDE_HOME=~/.claude

# Windows
CLAUDE_HOME=C:/Users/YourName/.claude
```

Everything else in `.env.local.example` is also optional and commented out — defaults work for most setups.

To read from **more than one** `.claude` folder (e.g. a WSL distro or Claude Desktop's data dir alongside your default one), skip the env var entirely — use the **Data Sources** panel at the bottom of the Home page sidebar instead. It lists your default path, lets you add others, and shows which ones are actually found on disk.

Open [http://localhost:3456](http://localhost:3456).

If you update Node.js or switch versions and see a 500 error on load, rebuild the native SQLite module:

```bash
npm run rebuild-native
```

**Reset the database** (clears the SQLite cache; sessions are re-indexed on next open):

```bash
npm run db:reset
```

### What happens on first open

The home page auto-discovers all Claude sessions from your `~/.claude/projects/` directory and lists them sorted by most recent. Click any session to open it. The first open of a session parses and indexes it — subsequent opens are served from the local SQLite cache instantly.

---

## A typical user journey

```
1. Run a Claude workflow as usual (e.g. "analyse this ticket and produce a deliverable").
   ↓
2. Open AgentWatch in the browser → pick the project → open the session.
   ↓
3. Read the agent hierarchy: see the orchestrator and every specialist agent.
   ↓
4. Check the analytics dashboard for an objective execution summary:
   cost, timing, cache efficiency, and any detected issues.
   ↓
5. Use AI Execution Analysis to understand how each agent followed its
   skill/agent instructions — and identify which agent needs feedback.
   ↓
6. Leave precise feedback on THAT agent / artifact — not on "the skill."
   Track all open feedback on the session-wide review page.
   ↓
7. Apply Improvements: AgentWatch turns the feedback into a targeted,
   evidence-based fix prompt. Review and approve each individual edit
   in the browser before it lands.
   ↓
8. Re-run the workflow to verify the improvement.
   ↓
9. Over many runs, watch trends in the Skills Dashboard.
   Enable self-healing (in progress) to let the workflow analyse and improve itself.
```

---

## Feature walkthrough

The features below are described in the order a user typically encounters them.

### Session Dashboard — runs become first-class

Browse projects and the sessions inside them, instead of digging through terminal history. Each run is a real, openable thing with a title, size, cost, and timing. Sessions can be pinned, tagged, and annotated. Sessions are organised by project, so related runs are always grouped together.

![Home page with sessions listed, grouped by project](<UI screenshots/home-page-project.png>)

**Why it matters:** runs stop being throwaway terminal output and become a reviewable, searchable record.

### Agent Hierarchy — see the team

A sidebar shows the full **tree of agents**: the orchestrator at the top and every specialist beneath it, in the order they ran, each labelled with its real name/role, model, tokens, duration, and health.

The hierarchy can also be viewed as a **Sequence** (chronological) view, and exported as clean text, SVG, PNG, or structured JSON for documentation, emails, and reviews.

**Why it matters:** in seconds you understand *who did what and in what order* — the thing that is impossible in a terminal.

### Multi-Pane Workspace — your investigation surface

The workspace is a flexible, multi-pane environment. Open any agent, artifact, timeline, analytics view, or context graph in its own pane. Split horizontally or vertically and compare anything side by side. Artifacts open **inside the pane** — no separate window or navigation needed — so you can view intermediate outputs while keeping the agent conversation in view. Your layout is automatically saved and restored as a **workspace snapshot**.

![Session workspace combining a vertical and horizontal pane split, real tool calls in the Conversation tabs, and an artifact open in-pane](<UI screenshots/Session workspace with Multi pane support and in pane artifact viewer.png>)

**Why it matters:** instead of scrolling endlessly, you build a focused investigation layout tailored to what you need to understand.

### Agent Detail — the full record of one agent

Open any agent to see its **Conversation**, the **Artifacts** it produced, the **Context** it received, the **Tools** it used, a **Summary**, and a **Feedback** tab. Health is shown honestly — a clean success looks different from "finished, but with errors or blocked actions."

The **Context** tab shows exactly where an agent sits in the call graph: its invocation chain from the orchestrator down, which agents' outputs informed its prompt, which agent it in turn fed into, and the literal prompt text it received from its parent.

![Agent Context tab showing invocation chain, informing agents, and prompt from parent](<UI screenshots/Agent Context tab showing invocation chain and prompt from parent.png>)

**Why it matters:** you can trace a single agent's reasoning and outputs without losing the thread.

### Artifact Viewing — intermediate work becomes visible

The files agents create and pass between each other become **first-class, traceable items** rather than hidden intermediate outputs. Browse them in a folder structure, preview their content inside the active pane, and trace which agent produced each one.

**Why it matters:** you can follow the chain — which artifact influenced which result.

### Cross-Agent Search — find anything, anywhere

Full-text search across every agent's messages in a session. Filter by agent, role, or content type to locate specific decisions, tool calls, or outputs.

**Why it matters:** when you know *what* you are looking for but not *where*, search gets you there in seconds.

### Context Flow — trace information between agents

A visual graph showing how context flows between agents — which agent received information from which other agent, and what was passed along.

**Why it matters:** when a downstream agent makes a bad decision, you can trace it back to the context it received.

### Execution Timeline — see when things happened

A dedicated timeline view showing agents as they executed over time, with artifact markers. See parallelism, gaps, and ordering at a glance.

**Why it matters:** understand the *when* and *how long* alongside the *what* — spot bottlenecks and idle time.

### Analytics Dashboard — evidence-based execution metrics

The analytics page provides **computed facts** about every session:

| Metric area | What you see |
| --- | --- |
| **Summary metrics** | Total agents, tokens, cost, duration, models used, cache efficiency |
| **Cost breakdown** | By model, by agent, and by phase |
| **Critical path** | The longest chain of dependent agents that determined total duration |
| **Debug alerts** | Automatically detected issues: bottlenecks, retry loops, duplicate work, excessive tool usage, context bloat |
| **Agent report cards** | Per-agent outcome assessment with token efficiency and error categorisation |

**Why it matters:** you get an objective, quantitative view of what happened — not opinions, but evidence.

### AI Execution Analysis — identify which agents need feedback

This is the bridge between observing a run and knowing exactly where feedback should go.

AgentWatch builds a rich prompt containing the full session structure, agent hierarchy, tool call timelines, artifacts, and — crucially — the **skill and agent instructions** each agent was operating under. Claude then judges every agent against **three independent lenses**, not just whether it followed the rules — a clean result on one lens never excuses the others, so an agent can pass all three, one, or none:

| Lens | Question it answers | Evidence it's grounded in |
| --- | --- | --- |
| **Execution Findings** | Did the agent's *process* comply with its skill/agent definition? | Tool calls and actions from the JSONL |
| **Outcome Quality** | Was what the agent actually *produced* adequate for the task — independent of whether the process was clean? | The artifact or final message content itself, read directly — not inferred from tool-call success |
| **Enhancement Opportunities** | Could the definition itself ask for more, so every future run benefits — even when this run was fully compliant and the result was fine? | A generalizable gap between the definition and what this session's evidence shows would help |

The last lens exists specifically so a workflow that has matured past its early execution bugs doesn't fall silent: a session where every agent complied and every result was adequate can still surface a concrete way to strengthen the definition, because compliance with the current instructions is never treated as proof those instructions are already optimal. Each of the three is designed to avoid re-describing the same incident from a different angle — an item only qualifies for a lens if it isn't already explained by one of the others.

The result is not a general performance report. It is a targeted answer to the question: *"Which agent should I give feedback to, and why?"*

![Analysing the session execution against skill/agent instructions using AI analysis](<UI screenshots/Analysing the session execution against the instruction of skill or agent using AI analysis for insights on giving feedback.png>)

The AI analysis surfaces:
- Where an agent's output diverged from what its skill or agent instructions required (Execution Findings)
- Where a compliant run still produced an incomplete or incorrect deliverable (Outcome Quality)
- Where a skill or agent definition could be made more thorough, based on what this specific session revealed (Enhancement Opportunities)
- Root causes for failures, traced back to the specific agent that introduced them
- Delegation quality — whether the orchestrator split work appropriately

Every item across all three lenses can be attached directly as ready-to-paste feedback on the specific agent it traces to — the same one-click flow, whether it's a process finding, a quality gap, or a definition enhancement.

The analysis streams live in the browser — thinking blocks, tool calls (colour-coded by type), text output, and progress indicators auto-scroll as new events arrive. Each analysis cycle is stored for future reference.

You choose which model (Haiku, Sonnet, or Opus) drives the analysis, and can stop a run mid-flight if it's no longer needed — both save tokens on a run you no longer want. Execution analysis always spawns a brand-new one-shot Claude Code session rather than resuming the session being analysed, so AgentWatch surfaces that new session's id on the cycle (click to copy) — useful if you want to `claude --resume <id>` into it later to see exactly how the analysis itself was produced. A small badge on the cycle also shows the model the CLI actually reported running, confirming your choice took effect.

**Why it matters:** instead of guessing which agent caused a problem, you get an evidence-based answer grounded in the actual instructions the agents were given — and instead of the analysis going quiet once a workflow stops having bugs, it keeps finding ways to make the workflow *better*, not just *correct*.

### Feedback — the most important capability

Feedback is attached to the **exact agent, the exact execution, and the exact artifact** that caused an issue — not to "the workflow" in general. Once you know from the AI analysis which agent to target, you attach structured feedback directly to it.

```
AI Analysis identifies the agent → Feedback attached to that agent
→ Specific Execution → Specific Artifact
```

Ten structured categories keep feedback precise:

| Category | What it covers |
| --- | --- |
| Missing context | The agent lacked information it needed |
| Incorrect assumption | The agent assumed something false |
| Hallucinated conclusion | The agent stated something that was not in its context |
| Weak validation | The agent accepted a result it should have questioned |
| Missing edge case | The agent did not handle a known scenario |
| Missing artifact | The agent should have produced an output it did not |
| Missing code exploration | The agent did not read relevant code |
| Missing test coverage | A test scenario was omitted |
| Workflow improvement | The overall flow could be structured better |
| Other | Free-form notes |

A **session-wide review page** aggregates all feedback items from the session in one place, so you can see the full picture — which agents have open feedback, which issues have been addressed, and what still needs attention — without jumping between agent views.

![Targeted feedback attachment and session-wide feedback tracking on the review page](<UI screenshots/Targeted feedback attachment and session wide feedback tracking on review page.png>)

**Why it matters:** feedback becomes specific and evidence-based. The session-wide review page ensures nothing gets lost and every open issue is visible at a glance.

### Apply Improvements — turn notes into a precise fix

AgentWatch summarises the collected feedback and generates an improvement prompt grounded in **agent-specific evidence**, not vague impressions. Claude then applies the fix in a live, streaming session.

The key feature here is **per-edit approval**: every individual Edit or Write operation Claude proposes is intercepted by the PreToolUse hook and routed to the browser. You see a diff preview, the target file, and Approve / Deny buttons — and you decide on each change separately. Claude Code applies the edit itself after approval, keeping its internal state in sync with the filesystem.

By default, this is not a bulk approve-or-reject — you review and approve or deny **each edit individually** before it lands. A **skip-permissions toggle** in the Feedback Review panel header lets you opt out of that gate for a given cycle instead: Claude Code launches with `--dangerously-skip-permissions` and applies every edit automatically, no review step. Each cycle records which mode it ran in, so the improvement history always shows whether it was reviewed edit-by-edit or applied unattended.

You can also pick the model (Haiku, Sonnet, or Opus) for the cycle, and stop it mid-flight if it's stuck or no longer needed — unlike execution and skill analysis, an improvement cycle resumes the original session (`--resume`) rather than starting a new one, so there's no separate session id to surface here.

![Improving a skill based on feedback, with per-edit approval support](<UI screenshots/Improving skill based on feedback with Approve on edit support.png>)

**Why it matters:** the improvement targets the real cause, you stay in control of exactly what changes (or explicitly trade that off for speed when you trust the fix), and you never need to switch to the terminal to approve edits.

### Cross-Project Skill Improvements — fix skills wherever they live

Real-world workflows often span multiple projects. A session might run in one repository but use skills and agents defined in a separate shared config repository.

AgentWatch handles this automatically:

1. **Detection** — When an improvement cycle starts, AgentWatch parses the session data to find every `.claude/skills` and `.claude/agents` path referenced during the run. Any path outside the session's own project directory is identified as external.
2. **Read access** — External directories are passed to Claude Code via the `--add-dir` flag, granting native read access without extra approval prompts.
3. **Write access** — Edits to external files go through the same browser-based per-edit approval gate as local edits.

**Why it matters:** improvements land where the root cause actually lives, even when skills are maintained in a separate repository.

### Improvement History — every change is traceable

Each improvement cycle is recorded — the feedback behind it, the generated prompt, the streaming response, and the file diffs it produced. Any improvement cycle can be **rewound** if it did not work out.

**Why it matters:** you can see how a workflow evolved over time, why each change was made, and undo what did not help.

### Skills Dashboard — learn across many runs

Instead of improving one run at a time, the Skills Dashboard aggregates execution data, feedback, and improvement history across **all sessions** that used a given skill. It answers: *"How is this workflow performing over time, and what keeps going wrong?"*

#### Skills list

The top-level skills page shows every registered skill as a card, organised by project. Each card displays the skill name, project, description, execution count, session count, feedback count, average duration, and self-healing status.

Skills are discovered automatically from Claude Code session data — not configured manually. When a session uses a skill (slash command), AgentWatch records the invocation and builds the skill registry from actual usage.

When you select a project in the sidebar, a **Project Documents** panel appears above the skill grid — attach a `.xlsx`, `.pptx`, `.md`, or `.txt` file once (e.g. a maturity-model assessment, a repo audit, or a prior evaluation report) and every skill in that project can draw on it during analysis, instead of re-uploading the same document per skill. A skill can still have its own additional documents on top of the project-wide ones, attached from its Overview tab.

**Why it matters:** these documents are the yardstick AI-powered skill analysis measures against. Without one, analysis can only compare a skill to its own past runs. With an evaluation result attached — an AI-maturity model score, a repo audit, a prior assessment — the AI grounds its findings in that framework instead of generic advice: it cites the specific condition or finding the skill currently falls short of, and proposes changes aimed at closing that gap. Re-attach the latest evaluation after each round of fixes and skill analysis compounds over time — each cycle building on where the last one left off — steadily advancing the skill up the maturity model toward genuinely efficient AI usage across the software development lifecycle, instead of producing a one-off report.

![Skill dashboard to analyse a skill across sessions, with self-heal configuration](<UI screenshots/Skill dashboard to analyse the skill across the sessions and with option to configure the self heal(just ui created).png>)

#### Skill detail — four tabs

| Tab | What it shows |
| --- | --- |
| **Overview** | Self-healing configuration, skill metadata, top feedback categories, skill-specific context documents |
| **Executions** | Paginated table of every execution: session, agent, timing, feedback count |
| **Feedback** | Three views: by session, by category (bar chart + top agents breakdown), and full history (improvement cycles + analysis cycles + open/closed feedback items) |
| **Analysis** | Choose a model and preview/edit the analysis prompt, trigger analysis, view live stream, stop a run in progress, and review cycle history — current status, findings & fixes, and growth opportunities |

![Skill detail Overview tab, with self-healing config, skill metadata, and project/skill documents](<UI screenshots/Skill detail Overview tab with self-healing config, project and skill documents.png>)

#### AI-powered skill analysis

The Analysis tab lets you ask Claude to analyse a skill's entire execution history — drawing on **both accumulated feedback and past improvement cycle data** across all sessions, plus any attached context documents — and produce a structured report. This cross-session view reveals patterns that no single run can show: recurring failure modes, feedback categories that keep appearing, and whether past improvements actually stuck.

![Analysing a skill with AI using feedback and improvement cycle data across sessions](<UI screenshots/Analysing the skill with ai using feedback and improvement cycle data across the sessions.png>)

Each report has three parts:

| Section | What it covers |
| --- | --- |
| **Current Status** | The skill's health trend (improving, stable, or degrading), how reliably it's being used, and — if a maturity/audit document is attached — where it sits against that framework |
| **Findings & Fixes** | Concrete recommendations with root cause, evidence, and confidence — the same depth as Execution Analysis, not a one-line label |
| **Growth Opportunities** | Separate from bug fixes — how the skill could do more or do it better within the SDLC, ranked by impact |

Attached documents are **optional** — a skill with none still gets an equally thorough report, sourced from its definition and execution history. When a document is used, the model **cites it inline** (e.g. "per Zeroni_AI_Maturity_Assessment.xlsx, condition tst_s1_2 (Not Met)...") rather than vaguely referencing it, so it's verifiable that the document was actually read.

As with Execution Analysis, you choose the model, can stop a run in progress, and get a badge confirming the model the CLI actually used plus a copyable id for the new one-shot session it ran in.

**Why it matters:** you stop fixing single executions and start improving the **workflow itself** — with evidence from every run, not just the last one.

### Self-Healing — workflows that improve themselves

**Status:** 🔧 In Progress — UI ready, automation being implemented

The Self-Healing feature provides the configuration UI for enabling automatic skill improvement. When complete, a skill will be able to **analyse its own history** after a configurable number of runs, produce an improvement report and a suggested fix, which you then review and apply.

```
Skill → N Executions → Automatic Analysis → Improvement Report
→ Generated Fix → Human Review → Apply
```

Three planned operating modes:

| Mode | Behaviour |
| --- | --- |
| **Analysis only** | Produces the report and recommendations — you decide what to do |
| **Analysis and fix** | Generates the fix — you review and approve before it lands |
| **Fully automatic** | Analyses, generates, and applies the fix — you review after the fact |

The self-healing configuration UI is available on the Skills Dashboard (Overview tab), where you can toggle self-healing on or off and select a mode. The underlying automation is being implemented.

**Why it matters:** when complete, AgentWatch will graduate from an observability tool to a **workflow-evolution platform** — one that can propose and apply its own improvements based on accumulated evidence.

### Threshold Alerts — know when sessions need attention

As Claude Code sessions run — sometimes for hours, sometimes in parallel — cost and duration can grow without anyone noticing. AgentWatch includes a **threshold monitoring system** that continuously watches active sessions and alerts you when they cross configurable limits.

#### How monitoring works

A background monitor runs every **2 minutes** inside the AgentWatch server process:

```
Active Sessions → Scan (every 2 min) → Compare cost and duration against thresholds
→ DB Alert + WebSocket → Teams Notification (consolidated)
→ Auto-resolve when session ends
```

Each cycle, the monitor scans all active session files, computes current cost and duration, compares against configured thresholds, creates alerts in the database, and broadcasts real-time updates to the browser via WebSocket.

#### Alerts page

![Alerts tab showing alerts for active sessions whose cost or time crossed the configured threshold](<UI screenshots/Alerts tab where the alerts are created for the active sessions whose cost or time has been crossed the configured threshold.png>)

The Alerts page in the browser shows:

| Section | Content |
| --- | --- |
| **Active alerts** | Sessions currently exceeding a threshold, with session title (linked), threshold type, actual vs. threshold value, cost, tokens, duration, and a Dismiss button |
| **Resolved alerts** | Collapsible section showing alerts that auto-resolved when the session ended |
| **Settings** | Cost threshold (dollars), duration threshold (hours), and Teams webhook URL |

Setting a threshold to 0 disables that check. Dismissed alerts are suppressed for the remainder of that session to prevent alert fatigue.

#### Teams notifications

Every monitor cycle sends a **single consolidated notification** to Microsoft Teams via a Power Automate webhook. The card includes:

- A header with the check timestamp and threshold values
- Summary metrics — total cost across all breaching sessions and session count
- Per-session rows — each breaching session listed with its title (clickable link to the AgentWatch workspace), cost, token count, duration, and source
- An action button linking to the AgentWatch Alerts page

![Session alerts sent to a Teams channel via webhook](<UI screenshots/The session alerts sent to teams channel using webhook.png>)

Notifications are sent every cycle for every active session crossing the threshold — not just once per alert. This is a deliberate design choice, not an oversight: a session that has crossed a threshold is usually still **actively running**, which means cost and duration keep climbing after the first alert. If AgentWatch only sent one notification per breach, a user who misses that single message — away from Teams, notification buried, on a call — would have no further signal that the session is still burning cost well past the threshold. Repeating the notification every 2-minute cycle, with updated cost/duration numbers each time, means a missed first alert doesn't turn into a silent, unbounded overrun.

To keep this from becoming noisy once a session **has** been reviewed, the Alerts page **Dismiss** button suppresses further notifications for that specific session and threshold for the rest of its run — so the repetition only continues for sessions nobody has acknowledged yet.

**Why it matters:** cost and duration surprises are caught early, with real-time browser alerts and recurring Teams notifications.

### Multi-Source Support — WSL, Windows, Claude Desktop, and beyond

AgentWatch can read Claude data from **multiple sources** on the same machine — for example, a native Windows `.claude` folder, a WSL Linux `.claude` folder, and a Claude Desktop data directory, all at once.

Sources are managed entirely from the browser — no env vars or config files to edit. The **Data Sources** panel at the bottom of the Home page sidebar shows your default path (auto-detected, always present) and lets you add, label, and remove additional ones; each entry shows whether it's actually reachable on disk. Once more than one source is configured, a switcher appears in the top bar to jump between them.

**Why it matters:** if you use Claude across environments, you see all your work in one place — and setting it up takes a form, not a restart.

### Export — take insights with you

Export session data as JSON, Markdown, or HTML. Export the agent hierarchy as text, SVG, PNG, or JSON. Copy the analytics summary as structured text for pasting into improvement prompts or reports.

**Why it matters:** insights are portable — share them in emails, documents, pull requests, and team discussions.

---

## Current status

AgentWatch is an **actively-developed internal tool**, not a finished, versioned product.

| Aspect | Status |
| --- | --- |
| **Usage today** | In daily use inside the team — 2 developers run it against their real Claude Code sessions as part of their normal workflow, not as a demo |
| **Deployment model** | Self-hosted, single-user per instance — each person runs their own local copy against their own `~/.claude` data. No shared server or multi-tenant deployment yet |
| **Feature completeness** | Observability, feedback, and apply-improvements are stable and used daily. Self-Healing (automatic fix generation) has its UI built but the automation behind it is still being implemented — see the Self-Healing section above |
| **Release process** | None yet — no version numbers, changelog, or support SLA. Updates land straight on the main branch |
| **Best fit today** | Individual developers or reviewers who want visibility into their own Claude Code sessions. Not yet built for team-wide shared dashboards |

**Why it matters:** tells you whether to adopt it as-is for your own day-to-day use today, or wait for shared hosting and self-healing automation before planning team-wide rollout.

---

## The bigger picture

As more work is delegated to AI agents, workflows become increasingly autonomous. The more autonomous they are, the more **observability becomes mandatory** — because you cannot improve what you cannot observe.

AgentWatch provides the full progression for Claude-based workflows:

> We started with a simple question — *how do we observe multi-agent workflows?* That led to **feedback**. Feedback led to **continuous improvement**. And continuous improvement leads toward **self-healing AI systems**.

---

## Glossary

| Term | Plain meaning |
| --- | --- |
| **Agent** | An AI worker assigned to one specific part of a task |
| **Orchestrator** | The "manager" agent that coordinates the others |
| **Multi-agent workflow** | A task done by a team of cooperating AI agents |
| **Session** | One complete run of a workflow |
| **Artifact** | A file or output one agent produces and passes to the next |
| **Skill** | A reusable, packaged workflow (e.g. "analyse a ticket and produce a deliverable") |
| **Observability** | Being able to see and understand what happened inside a run |
| **Execution analysis** | AI-powered analysis of a session judging every agent against three independent lenses — execution findings, outcome quality, and enhancement opportunities — surfacing which agents need feedback |
| **Execution finding** | A process-level deviation: a specific instruction in a skill/agent definition that wasn't followed, evidenced by tool calls and actions |
| **Outcome finding** | A content-level gap: the agent's process was compliant, but the artifact or response it actually produced still fell short of what the task needed, evidenced by the deliverable itself |
| **Enhancement opportunity (execution analysis)** | A generalizable way a skill/agent definition could ask for more, revealed by this session's evidence — reported even when the agent fully complied and the result was adequate; not the same as a skill analysis "growth opportunity" below |
| **Execution facts** | Algorithmically computed metrics about a session (cost, timing, errors) |
| **Workflow drift / skill poisoning** | A workflow slowly getting worse because of vague, misdirected feedback |
| **Self-healing** | A planned feature: a workflow that reviews its own runs and proposes its own fixes automatically |
| **Edit approval gate** | A browser-based review step where you approve or deny each individual file change before it is applied |
| **Skip-permissions mode** | An optional per-cycle toggle that bypasses the edit approval gate — Claude Code runs with `--dangerously-skip-permissions` and applies every edit automatically; recorded on the cycle so history shows which mode it ran in |
| **PreToolUse hook** | A Claude Code hook that fires before a tool executes; AgentWatch uses an HTTP hook to route Edit/Write permission requests to the browser |
| **Cross-project skills** | Skills or agents defined in a different project than the one the session ran in; AgentWatch detects and grants access to these automatically |
| **Skill analysis** | AI-powered cross-session analysis drawing on feedback, improvement cycle history, and optional context documents, producing a report of current status, findings & fixes, and growth opportunities |
| **Context document** | An optional `.xlsx`, `.pptx`, `.md`, or `.txt` file (e.g. a maturity assessment or audit) attached at the project level (shared by every skill in that project) or the skill level, used as supplementary evidence during AI analysis |
| **Growth opportunity** | A structural, non-bug-fix suggestion from skill analysis for how a skill could do more, or do it better, within the software development lifecycle |
| **Session review page** | A session-wide view aggregating all feedback items, showing which are open and which have been addressed |
| **Threshold alert** | A notification created when an active session's cost or duration exceeds a configured limit |
| **Threshold monitor** | A background process that scans active sessions every 2 minutes and creates alerts for breaching sessions |
