# Backend Repository-Root Deployment

**Status:** preparation only. Nothing in this document has been applied to any
Render service, and no deployment has been performed.

This describes the repository-side groundwork for moving the Apex OS backend
Render service from `rootDir: backend` to a repository-root deployment. It
records what has been proven locally, what has not, and what a future
**staging-only** transition would need.

Production is unchanged. `render.yaml` is unchanged.

---

## 1. Why this is wanted

Render's Root Directory setting makes everything outside that directory
unavailable to the service **at both build time and runtime**. `render.yaml`
sets `rootDir: backend`, so `platforms/`, `shared/` and `database/` do not
exist as far as the deployed backend is concerned.

That is what blocks the backend half of the vertical-slice migration. It is a
deployment constraint, not a TypeScript one — no amount of code reorganisation
inside `backend/src/` works around it. See
[`../architecture/VERTICAL_SLICE_MIGRATION_MAP.md`](../architecture/VERTICAL_SLICE_MIGRATION_MAP.md).

Deploying from the repository root makes those sibling directories visible.

## 2. The hazard this preparation exists to prevent

Node resolves a bare specifier by walking ancestor `node_modules` directories
and stopping at the first hit. If dependencies are installed **inside**
`backend/` as well as at the repository root:

```
backend/dist/main.js   ->  backend/node_modules/@nestjs/common
platforms/**/*.js      ->  <root>/node_modules/@nestjs/common
```

Those are two different physical copies. `Injectable` becomes two different
classes, `reflect-metadata` keys stop matching, and Nest dependency injection
fails. The same split on `@prisma/client` produces two `PrismaClient`
constructors and two generated clients.

**This failure appears at runtime, after a completely green build.** That is
why it gets machine-checked rather than documented and hoped for.

The rule: **install once, at the repository root.** Never add an install step
that runs inside `backend/`.

## 3. What was added to the repository

| Path | Purpose |
| --- | --- |
| `scripts/deployment/verify-backend-root-layout.mjs` | Asserts the filesystem invariants a root deployment depends on. |
| `scripts/deployment/verify-backend-module-identity.mjs` | Proves one physical package installation per dependency. |
| root `package.json` scripts | `backend:build`, `backend:start`, `backend:verify-deployment-layout`, `backend:verify-module-identity`. |

Both verifiers use Node built-ins only. No dependencies, no install step, no
database connection, no application bootstrap. Neither prints environment
variable values.

```bash
npm run backend:verify-deployment-layout -- --prebuild
```

```bash
npm run backend:verify-module-identity
```

`--prebuild` or `--postbuild` is mandatory. The script refuses to run with an
implicit mode so a check is never silently skipped; `--postbuild` additionally
requires `backend/dist/main.js`.

### Expect these to fail on a normal development machine

`npm run install:all` runs `npm install` inside `backend/`, which installs a
full dependency tree there — 688 packages on the machine used for this work.
Both verifiers correctly report that as a violation.

That is not a problem to fix locally. The local layout is legitimate for
development, where the backend runs with cwd = `backend/` and imports nothing
from `platforms/`. These verifiers describe the **deployment** layout, and
belong in CI and the Render build command, not in a developer's inner loop.

### Layout checks (12)

1. root `package.json` exists
2. root `package-lock.json` exists — the authoritative install
3. `backend/package.json` exists
4. `backend/package-lock.json` does **not** exist — a second lockfile forks resolution
5. `backend/node_modules` installs **no packages** (see §4)
6. root `node_modules` exists
7. root `package.json` declares `backend` in `workspaces` — without it, hoisting never happens and every other guarantee is vacuous
8. `backend/dist/main.js` exists — `--postbuild` only
9. `backend/prisma/schema.prisma` exists
10. `platforms/` visible from the repository root
11. `shared/` visible from the repository root
12. `database/` visible from the repository root

### Identity checks

`@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs` and
`@prisma/client` are resolved from three logical locations — the repository
root, `backend/`, and `platforms/business/sales-crm/leads/backend/` — and must
resolve to one physical path each after `realpath` normalisation.
`@prisma/client` must additionally map to a single generated client root.

The platform location is **synthetic**: that directory does not exist yet.
`createRequire` only needs a path to anchor the ancestor walk, so the future
layout is verified without creating repository files.

## 4. `backend/node_modules` is not required to be absent

The natural-looking invariant — "`backend/node_modules` must not exist" — is
**wrong**, and was corrected during validation after it failed a known-good
clean install.

A correct root `npm ci --include=dev` *does* create `backend/node_modules`. It
contains exactly one entry:

```
backend/node_modules/.cache/prisma/master/<hash>
```

Backend's `postinstall` runs `npx prisma generate` with cwd = `backend/`, and
Prisma caches its query engines relative to cwd. That is a binary cache, not a
resolution source — Node never resolves a bare specifier into it.

Both verifiers therefore check for **installed package directories**, ignoring
dot-entries. Zero packages is the invariant; the `.cache` directory is benign.

## 5. Candidate staging settings — NOT APPLIED

Proposed for a **staging service only**. No Render dashboard setting has been
changed, and these values are candidates, not verified configuration.

| Setting | Candidate value |
| --- | --- |
| Root Directory | *(unset)* |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm --prefix backend run build` |
| Start Command | `npm --prefix backend run start:prod` |

`npm --prefix backend run <script>` sets the child process cwd to `backend/`,
which is what `prisma generate`, `prisma migrate deploy` and `node dist/main.js`
all depend on. This was verified (§7).

Adding the verifiers to the build command is recommended once the transition
itself is proven:

```bash
npm ci --include=dev && npm run backend:verify-deployment-layout -- --prebuild && npm run backend:verify-module-identity && npm --prefix backend run build && npm run backend:verify-deployment-layout -- --postbuild
```

## 6. Node version — unresolved prerequisite

**No Node version is pinned anywhere in this repository.** There is no
`engines` field, no `.nvmrc`, and no `NODE_VERSION` environment variable in
`render.yaml`.

None was invented as part of this preparation, because choosing one blind could
change the runtime under production on the next deploy.

This is a **prerequisite to resolve before the staging transition**, not a
finding to act on now:

1. Read the Node version the current production service actually runs.
2. Pin that exact version for the staging service.
3. Only then consider committing it to the repository.

Local validation ran on Node v24.16.0 / npm 11.13.0. **That is not evidence of
Render's version** — it is recorded only to describe the environment the
results below came from.

## 7. Validation performed

Executed in a clean `git clone` at `C:\tmp\apex-rootdeploy`, outside the working
repository, with the uncommitted scripts and root `package.json` copied in. The
directory was deleted afterwards.

| Step | Result |
| --- | --- |
| `npm ci --include=dev` at repository root | exit 0 — 1254 packages, ~2m |
| Root `package.json` edit vs. `package-lock.json` | lockfile remained valid — `npm ci` is strict and would have failed otherwise |
| `backend/node_modules` after clean install | `.cache/prisma` only — **0 packages** |
| `backend:verify-deployment-layout --prebuild` | exit 0 |
| `backend:verify-module-identity` | exit 0 — all 5 packages single-identity |
| `npm run backend:build` | exit 0 |
| Prisma generate target | `<root>/node_modules/@prisma/client` — single client |
| `backend/dist/main.js` | present |
| `backend/dist/backend/` nesting | absent — `node dist/main.js` stays correct |
| `backend:verify-deployment-layout --postbuild` | exit 0 |
| Resolution from `backend/dist/main.js` | all four critical packages → `<root>/node_modules` |

The last row matters most: it is the **actual runtime entry point**, not a
proxy for it.

`@nestjs/cli` initially appeared unresolved from `backend/`. It is installed at
the root with its `nest` binary present — `require.resolve` is simply not a
valid test for a bin-only package. No gap.

### Not validated

- **`backend:start` was not run.** `start:prod` executes
  `prisma migrate deploy`, which touches a database. Running it was out of
  scope and would have been unsafe.
- No application boot, no health-endpoint check, no Render behaviour of any
  kind. Everything above is local filesystem and resolution evidence.
- Nothing here proves the transition works on Render. That is what the staging
  step is for.

## 8. `backend/.npmrc` behaves differently from the root

`backend/.npmrc` contains `legacy-peer-deps=true`. Installing from the
repository root **ignores it**, and npm says so:

```
npm warn config ignoring workspace config at <root>/backend/.npmrc
```

Today, with `rootDir: backend`, Render installs inside `backend/` and that
setting **is** honoured. Under a root deployment it would not be.

The root `npm ci --include=dev` nevertheless succeeded, because `npm ci`
installs exactly what the lockfile records rather than re-resolving peers. This
is recorded as a real behavioural difference to watch on staging, not as a
known failure.

## 9. Rollback checklist

The repository changes are inert — they add scripts and documentation and
change no runtime behaviour, so rollback is only relevant to a future staging
transition.

If a staging service is switched to a repository-root deployment and fails:

1. Restore the staging service's Root Directory to `backend`.
2. Restore Install/Build/Start to the `render.yaml` values:
   `npm install --include=dev && npm run build` and
   `npx prisma migrate deploy && node dist/main.js`.
3. Clear the build cache and redeploy.
4. Confirm the service boots and `/api/health` responds.
5. Leave production untouched throughout — it was never part of the change.

Repository-side rollback, if ever wanted: `git revert` the preparation commit.
No migration, no schema change, no data implication.

## 10. What must not change

- **`render.yaml`** — read during this work, deliberately not modified.
  Production settings stay as they are until a staging transition has proven
  the alternative.
- **`package-lock.json`** — unchanged. Regenerating it is a separate, riskier
  change.
- **`backend/package.json`** — unchanged. `backend:build` and `backend:start`
  delegate to the existing `build` and `start:prod` scripts rather than
  restating them, so there is one definition of each.
- **`.gitignore`** — unchanged. `git check-ignore -v backend/node_modules`
  resolves to `.gitignore:2:node_modules/`, so the existing broad rule already
  covers nested directories at any depth. Adding a narrower rule would be
  redundant.
- No backend feature files, Prisma schema, auth, or Sales CRM Leads backend
  code was moved.

## 11. Next step

Resolve the Node version prerequisite (§6), then attempt the transition on a
**staging service only**, using §5 as the starting configuration and §9 as the
rollback path.

Backend vertical-slice migration remains blocked until that succeeds. See
[`../architecture/VERTICAL_SLICE_MIGRATION_MAP.md`](../architecture/VERTICAL_SLICE_MIGRATION_MAP.md).
