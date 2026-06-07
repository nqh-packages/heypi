#!/usr/bin/env python3
import sys
import re
import os
import yaml
from pathlib import Path

SEMVER_RE = re.compile(r'^\d+\.\d+\.\d+$')
H1_RE = re.compile(r'^#\s+(.+)$', re.MULTILINE)
CHANGELOG_HEADING_RE = re.compile(r'^##\s+(.+?)\s*$', re.MULTILINE)
CHANGELOG_VERSION_RE = re.compile(r'^(?:\[)?(?P<version>\d+\.\d+\.\d+)(?:\])?\s+-\s+\d{4}-\d{2}-\d{2}$')
FRONTMATTER_KEY_RE = re.compile(r'^([A-Za-z0-9_-]+):')


def validate_short_text(value, field_name, max_length):
    if not isinstance(value, str):
        return f"{field_name} must be a string, got {type(value).__name__}"
    if len(value) > max_length:
        return f"{field_name} is too long ({len(value)} characters). Maximum is {max_length} characters."
    return None


def validate_compatibility(value):
    if isinstance(value, str):
        return validate_short_text(value, 'Compatibility', 500)
    if isinstance(value, list):
        for index, item in enumerate(value, start=1):
            error = validate_short_text(item, f"Compatibility item {index}", 200)
            if error:
                return error
        return None
    return f"Compatibility must be a string or list of strings, got {type(value).__name__}"


def validate_skill(skill_path):
    """Basic validation of a skill"""
    skill_path = Path(skill_path)

    # Check SKILL.md exists
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        return False, "SKILL.md not found"

    # Read and validate frontmatter
    content = skill_md.read_text()
    if not content.startswith('---'):
        return False, "No YAML frontmatter found"

    # Extract frontmatter
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"

    frontmatter_text = match.group(1)
    frontmatter_keys = [
        key_match.group(1)
        for line in frontmatter_text.splitlines()
        if not line.startswith((' ', '\t'))
        for key_match in [FRONTMATTER_KEY_RE.match(line)]
        if key_match
    ]

    if len(frontmatter_keys) < 2:
        return False, "Frontmatter must start with 'name' then 'description'"
    if frontmatter_keys[0] != 'name':
        return False, "First frontmatter key must be 'name'"
    if frontmatter_keys[1] != 'description':
        return False, "Second frontmatter key must be 'description'"

    # Parse YAML frontmatter
    try:
        frontmatter = yaml.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return False, "Frontmatter must be a YAML dictionary"
    except yaml.YAMLError as e:
        return False, f"Invalid YAML in frontmatter: {e}"

    # Define recognized properties.
    # Portable Agent Skills fields come from the open spec. Harness fields are
    # observed first-class SKILL.md frontmatter in Claude Code, GitHub Copilot,
    # and major public skill repos; unknown fields warn instead of hard-failing
    # so validators do not lag behind fast-moving agent hosts.
    PORTABLE_PROPERTIES = {
        'name',
        'description',
        'license',
        'compatibility',
        'metadata',
        'allowed-tools',
    }
    LOCAL_PACKAGING_PROPERTIES = {'author', 'version', 'forked'}
    HARNESS_EXTENSION_PROPERTIES = {
        'argument-hint',
        'arguments',
        'when_to_use',
        'disable-model-invocation',
        'user-invocable',
        'model',
        'effort',
        'context',
        'agent',
        'hooks',
        'paths',
        'shell',
        'tools',
        'acknowledgments',
    }
    RECOGNIZED_PROPERTIES = (
        PORTABLE_PROPERTIES | LOCAL_PACKAGING_PROPERTIES | HARNESS_EXTENSION_PROPERTIES
    )

    warnings = []
    unexpected_keys = set(frontmatter.keys()) - RECOGNIZED_PROPERTIES
    if unexpected_keys:
        warnings.append(
            f"Unrecognized frontmatter key(s): {', '.join(sorted(unexpected_keys))}. "
            "Allowed as forward-compatible harness metadata; consider moving purely custom data under metadata."
        )

    # Check required fields
    if 'name' not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if 'author' not in frontmatter:
        return False, "Missing 'author' in frontmatter"
    if 'version' not in frontmatter:
        return False, "Missing 'version' in frontmatter"
    if 'description' not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    # Extract name for validation
    name = frontmatter.get('name', '')
    if not isinstance(name, str):
        return False, f"Name must be a string, got {type(name).__name__}"
    name = name.strip()
    if name:
        # Check naming convention (kebab-case: lowercase with hyphens)
        if not re.match(r'^[a-z0-9-]+$', name):
            return False, f"Name '{name}' should be kebab-case (lowercase letters, digits, and hyphens only)"
        if name.startswith('-') or name.endswith('-') or '--' in name:
            return False, f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens"
        # Check name length (max 64 characters per spec)
        if len(name) > 64:
            return False, f"Name is too long ({len(name)} characters). Maximum is 64 characters."

    author = frontmatter.get('author', '')
    if not isinstance(author, str):
        return False, f"Author must be a string, got {type(author).__name__}"
    author = author.strip()
    if not author:
        return False, "Author cannot be empty"

    forked = frontmatter.get('forked', False)
    if not isinstance(forked, bool):
        return False, f"Forked must be a boolean, got {type(forked).__name__}"

    local_author = os.environ.get('NQH_PACKAGES', 'nqh-packages').strip() or 'nqh-packages'
    if author != local_author and forked is not True:
        return False, (
            f"Third-party skill author '{author}' must set forked: true before local edits. "
            f"Expected local author is '{local_author}'."
        )

    # Extract and validate version
    version = str(frontmatter.get('version', '')).strip()
    if not SEMVER_RE.match(version):
        return False, f"Version '{version}' must use SemVer format X.Y.Z"

    body = content[match.end():].lstrip()
    h1_match = H1_RE.search(body)
    if not h1_match:
        return False, "Missing H1 heading in SKILL.md"
    h1 = h1_match.group(1).strip()
    if f"v{version}" not in h1:
        return False, f"H1 heading must include v{version}"

    # Extract and validate description
    description = frontmatter.get('description', '')
    if not isinstance(description, str):
        return False, f"Description must be a string, got {type(description).__name__}"
    description = description.strip()
    if description:
        # Check for angle brackets
        if '<' in description or '>' in description:
            return False, "Description cannot contain angle brackets (< or >)"
        # Check description length (max 1024 characters per spec)
        if len(description) > 1024:
            return False, f"Description is too long ({len(description)} characters). Maximum is 1024 characters."

    # Validate compatibility field if present (optional)
    compatibility = frontmatter.get('compatibility', '')
    if compatibility:
        compatibility_error = validate_compatibility(compatibility)
        if compatibility_error:
            return False, compatibility_error

    metadata = frontmatter.get('metadata')
    if metadata is not None and not isinstance(metadata, dict):
        return False, f"Metadata must be a YAML mapping, got {type(metadata).__name__}"

    for key in ('argument-hint', 'when_to_use', 'model', 'effort', 'context', 'agent', 'shell', 'tools', 'acknowledgments'):
        if key in frontmatter and not isinstance(frontmatter[key], str):
            return False, f"{key} must be a string, got {type(frontmatter[key]).__name__}"

    for key in ('disable-model-invocation', 'user-invocable'):
        if key in frontmatter and not isinstance(frontmatter[key], bool):
            return False, f"{key} must be a boolean, got {type(frontmatter[key]).__name__}"

    for key in ('allowed-tools', 'arguments', 'paths'):
        if key not in frontmatter:
            continue
        value = frontmatter[key]
        if not isinstance(value, (str, list)):
            return False, f"{key} must be a string or list, got {type(value).__name__}"
        if isinstance(value, list) and not all(isinstance(item, str) for item in value):
            return False, f"{key} list entries must all be strings"

    changelog = skill_path / 'CHANGELOG.md'
    if not changelog.exists():
        return False, "CHANGELOG.md not found"

    changelog_text = changelog.read_text()
    changelog_heading = CHANGELOG_HEADING_RE.search(changelog_text)
    if not changelog_heading:
        return False, "CHANGELOG.md must start with a version entry like '## 1.0.0 - YYYY-MM-DD'"

    changelog_version_match = CHANGELOG_VERSION_RE.match(changelog_heading.group(1).strip())
    if not changelog_version_match:
        return False, "CHANGELOG.md must start with a version entry like '## 1.0.0 - YYYY-MM-DD'"

    changelog_version = changelog_version_match.group('version')
    if changelog_version != version:
        return False, f"CHANGELOG.md top version {changelog_version} does not match frontmatter version {version}"

    message = "Skill is valid!"
    if warnings:
        message += "\nWarnings:\n- " + "\n- ".join(warnings)

    return True, message

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)
    
    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)
