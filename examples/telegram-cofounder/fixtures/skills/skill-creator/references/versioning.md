# Skill Versioning

Use when creating or changing any skill.

## Required Files

| File | Requirement |
|------|-------------|
| `SKILL.md` | YAML frontmatter first key is `name`. |
| `SKILL.md` | YAML frontmatter second key is `description`. |
| `SKILL.md` | Frontmatter includes `author`. |
| `SKILL.md` | Frontmatter includes `version: X.Y.Z`. |
| `SKILL.md` | First H1 includes the same version as `vX.Y.Z`. |
| `SKILL.md` | Third-party adaptations include `forked: true`. |
| `CHANGELOG.md` | Exists in the skill root. |
| `CHANGELOG.md` | Top entry matches frontmatter version. |

## Recognized Frontmatter

| Class | Fields | Validation posture |
|------|--------|--------------------|
| Portable Agent Skills spec | `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` | Validate shape and constraints. |
| Local package contract | `author`, `version`, `forked` | Required for Huy-managed skills. |
| Harness skill extensions | `argument-hint`, `arguments`, `when_to_use`, `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell` | Allow as first-class `SKILL.md` fields; type-check known shapes. |
| Observed vendor extensions | `tools`, `acknowledgments` | Allow; type-check as strings. |
| Unknown fields | Any other top-level key | Warn, do not hard-fail. Prefer `metadata` for custom data. |

`argument-hint` is a first-class skill field in Claude Code skill docs and appears in major public skill repos. Do not force it under `metadata`.

## Field Suggestion Policy

| Field | Suggest when | Default posture |
|-------|--------------|-----------------|
| `license` | Shared, published, third-party, copied, or externally sourced skill. | Ask or infer from upstream. |
| `compatibility` | Host, CLI, MCP, OS, network, package, or runtime assumptions matter. | Add a string for one requirement or a YAML list of short strings for several concrete requirements. |
| `metadata` | Custom provenance, package, short description, source, or non-standard metadata is useful. | Prefer over new top-level keys. |
| `argument-hint` | User-invoked skill accepts arguments. | Strongly suggest as top-level. |
| `arguments` | Skill uses named/positional substitutions. | Suggest only for supporting hosts. |
| `disable-model-invocation` | Side-effect workflow should not auto-trigger. | Strongly suggest for commits, deploys, messages, publishing, and destructive workflows. |
| `user-invocable` | Background/reference/helper skill should stay out of the user command menu. | Suggest `false`. |
| `allowed-tools` | Safe required tools are known. | Suggest narrow entries; never add broad shell access casually. |
| `context`, `agent` | Isolated execution or a specific subagent is needed. | Suggest only for supporting hosts. |
| `model`, `effort` | A model/effort override is justified by real quality/cost needs. | Rare; require rationale. |
| `paths` | Activation should be scoped to files or folders. | Suggest for repo-local/domain-local skills. |
| `hooks`, `shell` | Lifecycle or shell behavior is host-specific and necessary. | Advanced only. |

Creation and review flows should output relevant optional fields and explicitly avoid unrelated fields. Maximal headers are an anti-pattern.

## Product Metadata Boundary

| Product | Boundary |
|---------|----------|
| Portable Agent Skills | Keep `SKILL.md` to open-spec fields plus justified harness extensions. |
| Claude Code | Invocation controls can be first-class `SKILL.md` fields. |
| Codex | Runtime trigger uses `name` and `description`; app/plugin UX belongs in `agents/openai.yaml`. |
| GitHub Copilot | `license` and `allowed-tools` are documented `SKILL.md` fields. |

## SemVer Policy

| Bump | Use For |
|------|---------|
| MAJOR | Breaking behavior, output contract, command protocol, required inputs, or migration burden. |
| MINOR | New command, capability, reference, script, supported workflow, or non-breaking behavior expansion. |
| PATCH | Clarification, typo, trigger tuning, bug fix, validator fix, eval-only update, or narrower wording. |

## SKILL.md Format

```markdown
---
name: example-skill
description: Create useful examples. Use when...
version: 1.0.0
author: nqh-packages
---

# Example Skill v1.0.0
```

Third-party adaptation:

```markdown
---
name: upstream-skill
description: Adapted workflow. Use when...
author: upstream-author
version: 1.0.1
forked: true
---

# Upstream Skill v1.0.1
```

## CHANGELOG.md Format

```markdown
# Changelog

## 1.0.0 - 2026-04-25

### Added

- Initial versioned release.
```

## Workflow Rules

| Situation | Action |
|-----------|--------|
| New skill | Start at `1.0.0` unless explicitly marked experimental by user. |
| New skill author | Set `author` from `${NQH_PACKAGES:-nqh-packages}`. |
| Existing unversioned skill | Add `1.0.0` and record the first versioned release. |
| Editing a versioned skill | Bump version and add a new top changelog entry. |
| Editing a third-party skill | If `author` is not `${NQH_PACKAGES:-nqh-packages}`, set `forked: true` before changing content. |
| Upstream-owned skill | Do not edit in place with `forked: false`; stage or install an upstream candidate instead. |
| Documentation-only correction | PATCH bump. |
| Router/reference split | MINOR bump unless behavior breaks. |
| Broken validator or enforcement change | PATCH for narrow fix; MINOR if it changes required package shape. |

Validation is blocking. Do not claim a skill is valid if frontmatter author,
version, fork ownership, first-key order, second-key order, H1, and top
changelog version disagree with the package contract.

## Hard Gate

| Gate | Behavior |
|------|----------|
| `quick_validate.py` | Validates one skill package. |
| `scripts/check-skill-packages.mjs` | Validates every staged changed skill package. |
| `/Users/huy/.git-hooks/check-skill-version-links.mjs` | Validates configured app/package to skill version locks. |
| Pre-commit | Runs the staged gate so invalid changed skills cannot commit. |

## App / Package Links

Use for skills that depend on a real app, package, CLI, runtime, MCP server, or
plugin.

| Rule | Meaning |
|------|---------|
| Do not require equal SemVer | Source and skill versions represent different artifacts. |
| Require explicit lock | `source.version` and `skill.version` record the reviewed pair. |
| Bump skill when behavior changes | If source behavior changes, update the skill or record why it still applies. |
| Update global config | `/Users/huy/.git-hooks/skill-version-links.json` is the relationship SSOT. |
| Internal sources start at `0.0.1` | Public release artifacts are the only sources that should use `1.x.x` or higher. |

Config shape:

```json
{
  "schemaVersion": "skill_version_links.v1",
  "links": [
    {
      "name": "example-skill follows @scope/package",
      "source": {
        "type": "package-json",
        "path": "/absolute/path/package.json",
        "version": "1.2.3"
      },
      "skill": {
        "path": "/absolute/path/skills/example-skill/SKILL.md",
        "version": "1.4.0"
      },
      "policy": "version-lock"
    }
  ]
}
```

Global artifact policy lives in `/Users/huy/.git-hooks/version-policy.json`.
