# Refuse drift between plan and apply

The installer's plan previews the previous value each `set` op replaces, and the
install record must snapshot exactly that value for uninstall to restore. We
decided that apply re-verifies the current value at every `set` path still
equals the plan-time `previous`, refuses with guidance when it does not
("config changed since the plan was rendered — re-run"), and records the
plan-time snapshot — so the preview, the secret guard, and the record all
describe one snapshot taken once, at plan time.

## Considered Options

- **Inherit the plan-time snapshot silently.** Single source, but apply would
  overwrite an edit made between plan review and `--apply` without the user's
  knowledge — violating the installer's first principle.
- **Keep re-deriving `previous` at write time** (previous status quo). The
  preview and the record can disagree, and the secret guard, which checks the
  plan-time value, no longer covers what is actually recorded.

## Consequences

A legitimate user edit between plan and apply costs one re-run of `init`. In
exchange, "never overwrite user configuration without the user's knowledge"
holds unconditionally, including the window between plan review and apply.

The record's snapshots are re-derived at apply time rather than copied from the
plan; because the drift check runs immediately before, the two are provably
equal, so the record does describe the plan-time snapshot without a separate
copy step.
