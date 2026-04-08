---
name: opencli-operate
description: Deprecated compatibility shim for the renamed opencli-browser skill. Use existing Chrome sessions to inspect and operate websites from the CLI.
allowed-tools: Bash(opencli:*), Read, Edit, Write
---

# OpenCLI Operate Compatibility Shim

`opencli-operate` has been renamed to `opencli-browser`.

This shim exists for one transition period so older prompts, scripts, and skill references keep working. The preferred new entrypoint is:

```bash
opencli browser ...
```

For compatibility, the legacy command name still works:

```bash
opencli operate ...
```

## Compatibility Rules

1. Prefer `opencli browser` in all new prompts and docs.
2. Existing `opencli operate` flows may continue to run unchanged during the transition.
3. When you need the full, current instructions, read [`../opencli-browser/SKILL.md`](../opencli-browser/SKILL.md).

## Minimal Workflow

```bash
opencli operate open https://example.com
opencli operate state
opencli operate click 3
opencli operate type 5 "hello"
opencli operate get value 5
opencli operate network
opencli operate close
```

## Migration

- Old skill name: `opencli-operate`
- New skill name: `opencli-browser`
- Old command: `opencli operate`
- New command: `opencli browser`

If both are available, choose the new `browser` name in all fresh automation.
