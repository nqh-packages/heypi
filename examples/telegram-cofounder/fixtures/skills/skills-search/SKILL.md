---
name: skills-search
description: Use when managing agent skills. Searches and installs via ctx7 (npx ctx7), skills.sh (npx skills), AND ClawdHub CLI (clawdhub). Run multiple CLIs together for complete results. Also use for publishing skills to ClawdHub.
---

# Agent Skills Management

Three CLIs for skill discovery and management. **Use all relevant sources** — they index different registries.

| | ctx7 (`npx ctx7 skills`) | skills.sh (`npx skills`) | ClawdHub (`clawdhub`) |
|-|--------------------------|--------------------------|------------------------|
| **Strength** | Keyword index, trust scores | Full repo clone, sees ALL skills | ClawdHub registry, versioned |
| **Search** | `search <kw>` | `find <kw>` (interactive) | `search "<query>"` |
| **Discovery** | May miss skills | Complete — clones repo | Registry only |
| **Skip prompts** | `echo "Y" \|` | `-y` flag | N/A |
| **Target agent** | `--Codex` | `-a Codex` | N/A |
| **Global** | `--global` + pipe Y | `-g` | Default: cwd/skills/ |
| **Install** | `npm` (via npx) | `npm` (via npx) | `npm i -g clawdhub` |

---

## Search — Run Multiple Sources

Run in parallel for complete results:

```bash
npx ctx7 skills search <keywords>
npx skills find <keywords>
clawdhub search "<keywords>"
```

---

## Discover All Skills in a Repo — Use skills.sh

When given a `skills.sh` URL or GitHub repo, use skills.sh — it clones the full repo and never misses skills:

```bash
npx skills add <owner/repo> --list
```

Cross-check with ctx7 for trust scores:
```bash
npx ctx7 skills info <owner/repo>
```

---

## Install Patterns

### ctx7 REQUIRES `owner/repo` format

`npx ctx7 skills install <skill-name>` does NOT work. ctx7 needs the full `owner/repo` path.

**How to find the repo for a skill:**

```bash
# 1. Search to find the skill
npx ctx7 skills search <keywords>

# 2. Get repo info — grep for the skill name to find its URL/repo
npx ctx7 skills info <owner/repo> 2>&1 | grep <skill-name>

# Common repos:
# wshobson/agents — 129+ skills (responsive-design, tailwind-design-system, etc.)
# getsentry/sentry-agent-skills — Sentry skills
```

### Global — prefer skills.sh (cleaner `-y` flag)
```bash
# skills.sh
npx skills add <owner/repo@skill> -g -y

# ctx7 (pipe Y to confirm multi-location prompt)
echo "Y" | npx ctx7 skills install <owner/repo> <skill> --global
```

### Project-scoped — always `cd` first, then use either
```bash
# skills.sh
cd /path/to/project && npx skills add <owner/repo@skill> -y -a Codex

# ctx7 (--Codex = .Codex/skills/ relative to cwd)
cd /path/to/project && npx ctx7 skills install <owner/repo> <skill> --Codex
```

### All skills in repo
```bash
npx skills add <owner/repo> --all          # skills.sh: all skills + all agents + -y
echo "Y" | npx ctx7 skills install <owner/repo> --all --global
```

### ClawdHub
```bash
clawdhub install <skill-name>
clawdhub install <skill-name> --version 1.2.3
```

---

## Update

```bash
# skills.sh
npx skills check     # check for updates
npx skills update    # update all

# ClawdHub (hash-based match + upgrade)
clawdhub update <skill-name>
clawdhub update <skill-name> --version 1.2.3
clawdhub update --all
clawdhub update <skill-name> --force
clawdhub update --all --no-input --force
```

---

## Other Commands

### List installed
```bash
npx ctx7 skills list [--Codex|--global]
npx skills list
clawdhub list
```

### Remove
```bash
npx ctx7 skills remove <name> [--Codex|--global]
npx skills remove <name> [-a Codex] [-y]
```

### Publish (ClawdHub only)
```bash
clawdhub login
clawdhub whoami
clawdhub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

---

## Quick Reference

| Intent | Command |
|--------|---------|
| Search all sources | `npx ctx7 skills search <kw>` + `npx skills find <kw>` + `clawdhub search "<kw>"` |
| Discover repo (full) | `npx skills add <repo> --list` |
| Install global | `npx skills add <repo@skill> -g -y` |
| Install project | `cd <dir> && npx skills add <repo@skill> -y -a Codex` |
| Install from ClawdHub | `clawdhub install <name>` |
| Install all in repo | `npx skills add <repo> --all` |
| List installed | `npx ctx7 skills list` + `npx skills list` + `clawdhub list` |
| Remove | `npx skills remove <name> -y` |
| Updates | `npx skills update` / `clawdhub update --all` |
| Publish | `clawdhub publish ./skill --slug <slug> --name "<name>" --version <ver>` |

---

## Details / Compare Skills

When user wants more details about search results before deciding to install:

1. Spawn **one haiku subagent** (`run_in_background: true`) with ALL candidate skill names
2. Agent fetches each SKILL.md directly from GitHub (see below)
3. Agent returns a **structured comparison** — key sections, scope, overlap, recommendation

### Fetch SKILL.md via `gh api` (MANDATORY — no install needed)

Repos use different directory layouts. Try paths in this order until one succeeds:

```bash
# Given: owner=callstackincubator, repo=agent-device, skill=dogfood

# Path 1: skills/<skill>/SKILL.md (skills.sh convention)
gh api "repos/<owner>/<repo>/contents/skills/<skill>/SKILL.md" \
  -H "Accept: application/vnd.github.raw"

# Path 2: .Codex/skills/<skill>/SKILL.md (Codex convention)
gh api "repos/<owner>/<repo>/contents/.Codex/skills/<skill>/SKILL.md" \
  -H "Accept: application/vnd.github.raw"

# Path 3: <skill>/SKILL.md (root-level, single-skill repos)
gh api "repos/<owner>/<repo>/contents/<skill>/SKILL.md" \
  -H "Accept: application/vnd.github.raw"
```

**One-liner with fallback chain** (copy this into subagent prompts):

```bash
OWNER="<owner>" REPO="<repo>" SKILL="<skill>" && \
gh api "repos/$OWNER/$REPO/contents/skills/$SKILL/SKILL.md" -H "Accept: application/vnd.github.raw" 2>/dev/null || \
gh api "repos/$OWNER/$REPO/contents/.Codex/skills/$SKILL/SKILL.md" -H "Accept: application/vnd.github.raw" 2>/dev/null || \
gh api "repos/$OWNER/$REPO/contents/$SKILL/SKILL.md" -H "Accept: application/vnd.github.raw" 2>/dev/null || \
echo "SKILL.md not found — try: gh api repos/$OWNER/$REPO/git/trees/main?recursive=1 --jq '.tree[].path' | grep -i skill"
```

**If all 3 fail** — find the actual path:

```bash
gh api "repos/<owner>/<repo>/git/trees/main?recursive=1" \
  --jq '.tree[].path' | grep -i "skill"
```

### FORBIDDEN

| Pattern | Why |
|---------|-----|
| Install to `/tmp` then read | Slow (60-90s per skill), leaves artifacts |
| `WebFetch` on raw.githubusercontent.com | `gh api` is authenticated and rate-limit-friendly |
| Guessing SKILL.md content | Always fetch — never summarize from search descriptions alone |

### Subagent prompt template

```
Fetch and compare these skills using `gh api`. For each, run the fallback chain:

1. owner/repo@skill-name
2. owner/repo@skill-name
...

Return a comparison table: purpose, key capabilities, deps, maturity, best-for.
```

---

## Auto-Commit (MANDATORY after install/remove/update)

After EVERY install, remove, or update operation that changes `~/.Codex/skills/`:

```bash
cd ~/.Codex && git add skills/ && git commit -m "feat(skills): install <skill-name> from <owner/repo>"
```

| Operation | Commit message |
|-----------|---------------|
| Install | `feat(skills): install <name> from <owner/repo>` |
| Remove | `feat(skills): remove <name>` |
| Update | `feat(skills): update <name>` |
| Install all | `feat(skills): install all from <owner/repo>` |

**Also commit** `plugins/` if changed (skills.sh updates plugin metadata):

```bash
cd ~/.Codex && git add skills/ plugins/ && git commit -m "feat(skills): install <name> from <owner/repo>"
```

---

## ClawdHub Notes

- Default registry: https://clawdhub.com (override with `CLAWDHUB_REGISTRY` or `--registry`)
- Default workdir: cwd (falls back to Clawdbot workspace); install dir: `./skills` (override with `--workdir` / `--dir` / `CLAWDHUB_WORKDIR`)
- Update command hashes local files, resolves matching version, and upgrades to latest unless `--version` is set
- Install: `npm i -g clawdhub`

---

## Examples

```bash
# Search all sources
npx ctx7 skills search sentry svelte
npx skills find sentry
clawdhub search "sentry"

# Discover all skills in a repo
npx skills add getsentry/sentry-agent-skills --list
npx ctx7 skills info getsentry/sentry-agent-skills  # trust scores

# Install single skill globally (skills.sh preferred)
npx skills add getsentry/sentry-agent-skills@sentry-fix-issues -g -y

# Install from ClawdHub
clawdhub install my-skill --version 1.2.3

# Install single skill in a project
cd ~/CODES/expo && npx skills add getsentry/sentry-agent-skills@sentry-react-native-sdk -y -a Codex

# Install all skills in repo to all agents
npx skills add getsentry/sentry-agent-skills --all

# Publish a skill to ClawdHub
clawdhub publish ./my-skill --slug my-skill --name "My Skill" --version 1.0.0
```
