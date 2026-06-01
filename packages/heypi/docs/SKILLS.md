# Scoped Skills

Scoped skills are small durable procedures for one scope. They are useful for runbooks, repeated channel workflows, service-specific investigation steps, and local conventions that should survive future turns.

They are off by default.

```ts
createHeypi({
	state: { root: "./state" },
	// ...adapters, agent, runtime
	approval: { approvers: ["U123456"] },
	skills: {
		enabled: true,
		scope: "channel",
		writePolicy: "approvers",
	},
});
```

`skills.scope` defaults to the top-level `scope`. See [`SCOPE.md`](SCOPE.md) for scope levels and filesystem layout.

## Behavior

When enabled, heypi:

1. lists skills in the selected scope,
2. injects a compact skill catalog as background context,
3. exposes `skill_list`, `skill_read`, `skill_write`, `skill_patch`, and `skill_delete`,
4. allows mutation according to `skills.writePolicy`,
5. validates skill names, size, frontmatter, obvious secrets/private keys, and prompt-injection-shaped text.

The skill catalog is intentionally small. Full skill bodies are read only when the agent calls `skill_read`.

Scoped skills are user-authored guidance, not trusted policy. They can help the model remember a workflow, but they must not override app config, approval policy, access control, or runtime safety.

## Format

`skill_write` takes `name`, `description`, and `content`. heypi generates the `SKILL.md` frontmatter:

```md
---
name: deploy-check
description: Check deployment health.
---

Run the health check command and summarize failures.
```

Skill names must use lowercase letters, numbers, `.`, `_`, or `-`.

Use `skill_patch` for exact replacements inside an existing skill. Ambiguous replacements fail unless `replaceAll` is set.

## Write Policy

`skills.writePolicy` controls mutation:

- `auto`: the agent can create, patch, replace, and delete scoped skills.
- `approvers`: only turns initiated by `approval.approvers` can mutate scoped skills.
- `off`: skills can be listed, read, and injected, but cannot be changed.

Defaults:

- when `approval.approvers` is configured: `approvers` for `channel` and `user`.
- without approvers: `off`.
- `adapter` and `agent`: `off` unless explicitly overridden.

## Not Included

heypi does not install, sync, or update third-party skill registries. It also does not expose supporting-file tools such as `skill_file_write` yet. Keep scoped skills self-contained until that is needed.
