# Destructive Operation Policy

## Definition
A destructive operation is any script, endpoint, or database command that permanently deletes, truncates, drops, or resets production data. 
Examples include: `deleteMany`, `delete`, `truncate`, `drop`, `reset`.

## The Policy
1. **Production Block:** All scripts containing destructive operations MUST utilize the `preventDestructiveOperation()` guard from `src/common/safety/destructive-operation-guard.ts`.
2. **Execution Refusal:** By default, if `APP_ENV=production`, the script MUST refuse to execute.
3. **Explicit Override:** To bypass the guard, the engineer must explicitly set `ALLOW_DESTRUCTIVE_OPERATIONS=YES_I_UNDERSTAND` in their environment variables. This explicit opt-in serves as a legal acknowledgement of risk.
4. **Peer Review:** Any PR adding a script that uses the explicit override must be reviewed and approved by at least two Lead Engineers.
5. **No Automated Overrides:** CI/CD pipelines are strictly prohibited from injecting `ALLOW_DESTRUCTIVE_OPERATIONS=YES_I_UNDERSTAND` into their environments.
