---
name: skill-creator
description: Create, improve, evaluate, and package skills for any coding-agent harness. Use when the user wants to create a skill from scratch, turn an existing workflow into a skill, improve or benchmark an existing skill, test skill triggering, or make a skill more portable across agents.
version: 1.4.1
author: nqh-packages
---

# Skill Creator v1.4.1

Creates and improves skills through a draft → eval → review → iterate loop.

## What This Skill Owns

| Owns | Does Not Own |
|------|---------------|
| Creating new skills | Blindly writing SKILL.md without validating discovery |
| Improving existing skills | Assuming one harness behaves like another |
| Running skill eval loops | Treating one harness's scripts as universal law |
| Packaging and trigger optimization | Forcing quantitative evals onto purely subjective skills |
| Making skills more harness-portable | Skipping human review when it is the main quality signal |

## Core Principle

| Principle | Meaning |
|----------|---------|
| Start from user intent | Understand what the skill should enable before writing it |
| Validate the real harness | A skill is not “done” if the current agent cannot discover or invoke it |
| Compare with and without the skill | Skills should outperform the baseline, not just look plausible |
| Keep instructions lean | Remove prompt weight that does not improve outcomes |
| Use router shape for multi-mode skills | Root `SKILL.md` activates, sets invariants, and routes; references own detailed behavior |
| Bake in mandatory steps | Discovery, validation, verification, and safety checks should be automatic, not optional commands |
| Keep frontmatter ordered | YAML frontmatter must start with `name`, then `description` |
| Version every skill | `author`, `version`, H1 version, and `CHANGELOG.md` are required and must match |
| Fork third-party adaptations | If changing a skill whose `author` is not `${NQH_PACKAGES:-nqh-packages}`, set `forked: true` before editing |
| Link app-related skills | If a skill depends on an app, package, CLI, or runtime, register it in the global skill version link config |
| Generalize, do not overfit | Improve the skill for a class of tasks, not just the example prompts |
| Stay harness-aware | Use the current agent's real capabilities, not habits imported from another harness |

## Capability Check First

Before doing anything else, determine what the current harness can actually do.

| Capability | Ask / Check | Why It Matters |
|-----------|-------------|----------------|
| Skill discovery | How does this harness discover and invoke skills? | You need a real trigger path |
| Subagents / parallel runs | Can you spawn independent runs? | Decides parallel vs serial evals |
| Browser / HTML review | Can you launch a viewer, or do you need static/manual review? | Decides review loop |
| Programmatic trigger eval | Is there a harness-specific way to test description triggering? | Needed for description optimization |
| Packaging / file presentation | Can you package and hand off the skill cleanly? | Affects final delivery |

## Workflow Modes

| Mode | Use When | Output |
|------|----------|--------|
| Draft | User wants a new skill | Initial SKILL.md + eval prompts |
| Improve | User already has a skill | Revised SKILL.md + clearer eval loop |
| Benchmark | User wants proof the skill helps | With-skill vs baseline comparison |
| Description optimization | User wants better triggering | Trigger eval set + improved description |
| Vibe mode | User wants lightweight iteration only | Fast qualitative loop, less formal benchmarking |

## Step 1: Capture Intent

Extract from the conversation first, then ask only for what is missing.

| Question | Why |
|----------|-----|
| What should this skill enable the agent to do? | Defines scope |
| When should it trigger? | Frontmatter description is the trigger surface |
| What inputs does it expect? | Shapes eval prompts and helper files |
| What outputs matter to the user? | Defines review criteria |
| Does it depend on an app, package, CLI, or runtime? | Decides whether to create a version link |
| Should this be benchmarked or just reviewed qualitatively? | Not every skill needs quantitative evals |

## Step 2: Decide The Harness Shape

| Situation | Recommended Shape |
|-----------|-------------------|
| Harness has real skill discovery + subagents | Full eval loop with with-skill and baseline runs |
| Harness has skill discovery but no subagents | Serial runs, lighter benchmarking |
| Harness has no native skill invocation | Simulate by loading the skill manually and following it explicitly |
| Browser available | Use the bundled review viewer |
| Headless / no browser | Generate static HTML or review inline |
| Trigger optimizer is harness-specific and unavailable | Skip or adapt description optimization |

## Step 3: Write The Skill

Choose the structure before writing content. Load
[references/skill-shapes.md](references/skill-shapes.md) for multi-command,
multi-mode, or growing skills.

| Skill Shape | Use When | Root `SKILL.md` Owns | Details Live In |
|-------------|----------|----------------------|-----------------|
| Single workflow | One narrow task with few branches | Full workflow | Root file |
| Router skill | Several user-invoked modes or commands | Activation, setup, shared laws, command routing | `reference/*.md` or existing `references/*.md` |
| Adapter-backed skill | Scripts, agents, or harness integrations matter | Adapter boundary and invocation rules | `scripts/`, `agents/`, reference files |
| Eval-heavy skill | Quality depends on measurable output | Eval policy and acceptance criteria | `evals/`, reports, fixtures |

Public commands must represent meaningful user intent. Non-optional checks such
as scan, setup, validation, and verify should be baked into command workflows
instead of exposed as standalone commands.

### Frontmatter Decision Workflow

Use [references/versioning.md](references/versioning.md) for the exact field classes. Do not add every supported field. Suggest only fields that match the skill's real invocation, portability, packaging, or safety needs.

| Field | Suggest when | Default |
|------|--------------|---------|
| `name` | Always | Required first key; match parent directory. |
| `description` | Always | Required second key; include what it does and when to use it. |
| `author`, `version`, `CHANGELOG.md` | Huy-managed skill package | Required local package contract. |
| `forked` | Local edit to third-party skill | Required as `true`. |
| `license` | Shared, published, copied, or third-party skill | Ask or infer from source. |
| `compatibility` | Requires a host, CLI, MCP server, OS, network, runtime, or package | Add only concrete requirements. |
| `metadata` | Needs custom provenance, package, short description, or source info | Prefer this over custom top-level fields. |
| `argument-hint` | User-invoked skill accepts arguments | Strongly suggest. Keep top-level. |
| `arguments` | Skill body uses named or positional argument substitution | Suggest if target host supports it. |
| `disable-model-invocation` | Side-effect workflow should be manual-only | Strongly suggest. |
| `user-invocable` | Background/context/helper skill should not appear in user menu | Suggest `false`. |
| `allowed-tools` | Safe tool needs are known and narrower than full session tools | Suggest the narrowest useful list with a security caveat. |
| `context`, `agent` | Skill should run isolated or in a specific subagent | Suggest only for supporting hosts. |
| `model`, `effort` | Quality/cost requires a specific model or reasoning level | Rare; justify before adding. |
| `paths` | Skill should activate only for specific file areas | Suggest for repo/folder-specific skills. |
| `hooks`, `shell` | Advanced host-specific lifecycle or shell behavior is required | Do not suggest unless explicitly relevant. |

When creating or reviewing a skill, include a short field recommendation: "Relevant optional fields: ..." and "Not adding: ..." for fields that might look tempting but do not fit.

### Product-Specific Metadata Boundary

| Target | Put metadata where |
|--------|--------------------|
| Portable skills | `SKILL.md` open-spec fields and `metadata`. |
| Claude Code invocation controls | First-class `SKILL.md` fields such as `argument-hint`, `disable-model-invocation`, `user-invocable`, `context`, and `allowed-tools`. |
| Codex app / plugin UX | `agents/openai.yaml` for `interface`, `policy`, `dependencies`, and permissions; keep `SKILL.md` focused on portable instructions. |
| Unknown custom data | `metadata` unless current harness docs prove a top-level field. |

### Versioning Rule

Load [references/versioning.md](references/versioning.md) when creating or
improving a skill.

| Change Type | Version Bump |
|-------------|--------------|
| Breaking behavior, output contract, or command protocol | MAJOR |
| New command, capability, reference, script, or supported workflow | MINOR |
| Clarification, bug fix, typo, trigger tuning, or narrow eval update | PATCH |

Every skill edit must update `CHANGELOG.md`. Validation is blocking when
frontmatter author, version, fork ownership, H1, and top changelog version do
not match the skill package contract.

Changed skill packages are hard-blocked by the staged gate at
`scripts/check-skill-packages.mjs`.

### App / Package Link Rule

If a skill is related to an app, package, CLI, runtime, MCP server, plugin, or
other source artifact, register the relationship in
`/Users/huy/.git-hooks/skill-version-links.json`.

| Field | Rule |
|-------|------|
| `source.path` | Absolute path to the source version file, usually `package.json`. |
| `source.version` | Current reviewed source version. |
| `skill.path` | Absolute path to the related `SKILL.md`. |
| `skill.version` | Current skill version that reviewed the source. |
| `policy` | Default to `version-lock`. |

Do not force source and skill SemVer numbers to be equal. They version
different things. The lock only says the current source version has been
reviewed by the current skill version.

New internal app/package sources start at `0.0.1`. Use `1.x.x` or higher only
when the source is a public release artifact declared in
`/Users/huy/.git-hooks/version-policy.json`.

When creating or improving an app-related skill:

1. Infer or ask for the source path.
2. Add or update the global version link.
3. Add at least one eval prompt that uses the linked app/package context.
4. Run `node /Users/huy/.git-hooks/check-skill-version-links.mjs`.

### Frontmatter Safety Rule

If a frontmatter value contains punctuation that YAML often misreads — especially `:`, `{}`, `[]`, `#`, quotes, or long natural-language sentences — quote it.

| Bad | Better |
|-----|--------|
| `description: Do X. Route to A: B and C.` | `description: "Do X. Route to A: B and C."` |

### Discovery Validation Rule

After writing or editing `SKILL.md`, validate the **actual harness discovery path**, not just the markdown.

| Check | Example |
|------|---------|
| Loader validation | Programmatic loader or actual skill discovery command |
| Explicit invoke path | `/skill:name`, reload, or equivalent harness command |
| Parse safety | Watch for frontmatter warnings that silently drop the skill |

## Step 4: Draft Test Prompts

Create 2-3 realistic prompts first. More later.

Save to `evals/evals.json`.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's real task prompt",
      "expected_output": "What success looks like",
      "files": []
    }
  ]
}
```

## Step 5: Run The Evals

### Preferred loop when independent runs are available

| Run Type | Purpose |
|----------|---------|
| With-skill | Show what the skill produces |
| Baseline | Show what happens without the skill, or with the old version |

### Workspace layout

```text
<skill-name>-workspace/
  iteration-1/
    <eval-name>/
      with_skill/
      without_skill/ or old_skill/
```

### Run policy

| Situation | Behavior |
|-----------|----------|
| Creating a new skill | Baseline is `without_skill` |
| Improving an existing skill | Baseline is old skill snapshot or previous iteration |
| No subagents available | Run serially and document the limitation |
| No baseline possible | Say so explicitly; do not pretend you benchmarked it |

## Step 6: Draft Assertions While Runs Execute

| Good Assertion | Bad Assertion |
|---------------|---------------|
| Objectively checkable | Vague quality judgment dressed up as pass/fail |
| Tied to user-visible outcome | Tied to trivia |
| Named clearly | Named generically |
| Scriptable when possible | Eyeballed repeatedly with no script |

Use qualitative review for subjective outputs like style, visual taste, and voice.

## Step 7: Grade, Aggregate, Review

### Quantitative outputs

| File | Purpose |
|------|---------|
| `grading.json` | Assertion-level grading |
| `benchmark.json` | Aggregated pass/time/token comparison |
| `benchmark.md` | Human-readable summary |
| `timing.json` | Runtime/token metadata |

### Review policy

| Situation | Behavior |
|-----------|----------|
| Browser available | Use `eval-viewer/generate_review.py` |
| Headless | Use `--static` output or inline/manual review |
| Human feedback arrives | Prioritize explicit complaints and deltas |
| Feedback is empty | Treat that as acceptance for those cases |

## Step 8: Improve The Skill

| Improvement Lens | What To Look For |
|------------------|------------------|
| Generalization | Is the fix broader than the exact sample? |
| Prompt weight | Is the skill making the model do busywork? |
| Why over MUST | Can the instruction be explained instead of shouted? |
| Bundling repeated work | Did the runs independently recreate the same helper script or workflow? |
| Harness fit | Does the revised skill still make sense for the current harness? |

## Step 9: Description Optimization

This step is **harness-dependent**.

| Situation | Behavior |
|-----------|----------|
| Current harness has a real trigger-eval path | Build should-trigger / should-not-trigger evals and optimize |
| Current harness lacks a reliable trigger-eval path | Skip, or explain what adapter is missing |
| Current tooling is harness-specific only | Say so explicitly; do not pretend it is agent-agnostic |

### Trigger Eval Rule

Queries must be realistic, concrete, and near the boundary.
Do not use toy negatives that prove nothing.

## Step 10: Package And Present

| Situation | Behavior |
|-----------|----------|
| Packaging tools available | Package the skill cleanly |
| Presentation tool available | Present the packaged output |
| Existing installed skill is read-only | Copy to a writeable temp path before editing |
| Name already exists | Preserve the original skill name unless the user explicitly wants a rename |

## Harness Adapters

This skill is **agent-agnostic by default**.
Use the current harness's real mechanisms.
Keep the core workflow separate from harness-specific execution.

| Layer | Role |
|-------|------|
| Core workflow | Draft, benchmark, review, iterate |
| Harness adapter | Trigger evaluation, text generation, discovery mechanics |
| Manual fallback | Clear downgrade path when automation is unavailable |

| Concern | Rule |
|---------|------|
| Skill invocation | Use the harness's real skill loading path |
| Parallel evaluation | Use subagents only if the harness actually supports them |
| Trigger optimization | Use harness-specific trigger tools only if they exist |
| Review loop | Browser, static HTML, or inline review depending on the environment |
| Bundled scripts | Treat scripts in this skill folder as implementation aids, not universal assumptions |
| Adapter boundary | Keep harness assumptions inside adapter code, not in the shared workflow |

## Anti-Patterns

| Anti-pattern | Why It Fails |
|-------------|--------------|
| Assume one harness's semantics apply everywhere | Skills, triggers, and eval paths differ |
| Validate markdown only, not discovery | A valid markdown file can still be undiscoverable |
| Use unquoted YAML descriptions with colons or similar punctuation | Frontmatter can parse incorrectly and silently drop the skill |
| Overfit to the sample prompts | Produces a brittle skill |
| Force quantitative assertions onto subjective work | Creates fake precision |
| Skip baseline comparison when it is feasible | You lose proof the skill helps |
| Treat bundled scripts as mandatory for every harness | Portability suffers |

## Output Format

Always return:

| Section | Content |
|---------|---------|
| Mode | Draft / improve / benchmark / description optimization / vibe |
| Harness check | Which capabilities are present or missing |
| Plan | What you will do next |
| Skill draft changes | SKILL.md edits or structure |
| Eval plan | Prompts, baseline policy, review loop |
| Risk / limitation | Missing adapter, missing browser, missing subagents, etc. |

## References

| Path | Use When |
|------|----------|
| `references/schemas.md` | You need the exact JSON shapes |
| `references/versioning.md` | You are creating or changing any skill |
| `references/skill-shapes.md` | You are creating or improving a multi-mode skill |
| `agents/grader.md` | You need grading guidance |
| `agents/comparator.md` | You need blind A/B comparison |
| `agents/analyzer.md` | You need benchmark interpretation |
| `scripts/check-skill-packages.mjs` | You need staged skill package enforcement |
| `scripts/` | The current harness can actually use the bundled tooling |
