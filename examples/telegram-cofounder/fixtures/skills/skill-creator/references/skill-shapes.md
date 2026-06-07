# Skill Shapes

Use when creating or improving skills that are growing beyond one linear
workflow.

## Impeccable Pattern

`impeccable` is the model for a mature multi-mode skill.

| Layer | Role |
|-------|------|
| Root `SKILL.md` | Activation, mandatory setup, shared laws, command menu, routing rules. |
| `reference/*.md` or existing `references/*.md` | One behavior per file: command instructions, audit criteria, implementation details. |
| `scripts/` | Deterministic helpers and harness adapters. |
| `agents/` | Optional persona or subagent definitions. |
| Metadata | Command descriptions, argument hints, or UI adapter data when a real consumer exists. |

## Router Skill Rules

| Rule | Requirement |
|------|-------------|
| Root stays hot | Keep only trigger conditions, invariants, setup, routing, and shared laws in `SKILL.md`. |
| Commands are user intent | Expose commands like `propose`, `review`, `implement`; avoid mechanical commands like `scan` or `verify`. |
| Automatic steps are baked in | Run setup, scan, safety checks, validation, and verification inside the relevant workflow. |
| References own depth | Move long templates, criteria, examples, and mode-specific instructions to the skill's reference folder. |
| Scripts are adapters | Use scripts for deterministic work, but do not make a script universal law across harnesses. |
| Root links are real | Every command reference in `SKILL.md` must point to an existing file. |

## When To Split

| Signal | Action |
|--------|--------|
| Root skill exceeds 150-200 lines | Move mode-specific detail to references. |
| Sections are only needed for one command | Move them to that command's reference file. |
| A step must always happen | Bake it into routing, not the command menu. |
| Several commands share setup | Keep setup in root and state that subcommands do not re-run it. |
| A detail is harness-specific | Put it in adapter docs or scripts, not shared workflow prose. |
| Eval or benchmark data grows | Move it to `evals/` and summarize acceptance in root. |

## Command Design

| Public Command | Good For |
|----------------|----------|
| `draft` | Create a new skill from intent. |
| `improve` | Revise an existing skill. |
| `review` | Audit skill structure, trigger quality, bloat, or eval coverage. |
| `benchmark` | Compare with-skill vs baseline or old-skill behavior. |
| `package` | Prepare a skill for installation or handoff. |

Avoid public commands for mandatory internals:

| Internal Step | Why Not Public |
|---------------|----------------|
| `scan` | Should happen before proposals, reviews, and implementation. |
| `validate` | Completion gate, not user intent. |
| `verify` | Must run after changes, not only when requested. |
| `setup` | Required preflight for commands that need it. |

## Review Checklist

| Check | Pass Condition |
|-------|----------------|
| Root size | Small enough to load every time without burying the decision rules. |
| Routing | No-argument, command match, and fallback behavior are explicit. |
| References | Each file has one owner behavior and is linked from root. |
| Mandatory steps | Required checks are automatic in workflows. |
| Harness boundary | Provider-specific mechanics stay in adapters. |
| Eval coverage | Trigger, behavior, and regression prompts cover boundary cases. |
