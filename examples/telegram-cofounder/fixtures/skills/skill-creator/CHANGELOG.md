# Changelog

## 1.4.1 - 2026-05-18

### Fixed

- Allow `compatibility` frontmatter to be a YAML list of short strings.

## 1.4.0 - 2026-04-26

### Added

- Add relevance-based optional frontmatter suggestions for skill creation and review.
- Document product metadata boundaries for portable skills, Claude Code, Codex, and GitHub Copilot.

### Fixed

- Allow current first-class skill frontmatter extensions such as `argument-hint`.
- Warn instead of hard-failing on unknown future harness metadata.
- Document portable, local, harness, and observed vendor frontmatter classes.

## 1.3.0 - 2026-04-26

### Added

- App/package-related skills must register a global skill version link.
- Documented version-lock policy for source artifacts and related skills.
- Added the global skill link checker to versioning gates.

## 1.2.0 - 2026-04-25

### Added

- Required `name` then `description` frontmatter order.
- Added `forked` frontmatter support for third-party skill adaptations.
- Hard-blocked locally edited third-party skills unless `forked: true`.

## 1.1.0 - 2026-04-25

### Added

- Required `author` frontmatter for skill packages.
- Staged skill package gate for blocking invalid changed skills.
- New skill author default rule using `$NQH_PACKAGES` when available.

## 1.0.0 - 2026-04-25

### Added

- First versioned release for `skill-creator`.
- Blocking skill version validation for frontmatter, H1, and changelog.
- Canonical skill versioning reference.
