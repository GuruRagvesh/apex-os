# apps/api/

The NestJS HTTP API: bootstrap and module composition.

**Status: Phase 0 — empty scaffold.** `backend/` at the repository root is the
live API. It builds, it deploys to Render, and it serves production traffic
today. This folder receives its contents progressively, one migrated component
at a time.

## Responsibility

Boot the server and compose feature modules. Nothing else.

## May live here

- `src/main.ts` — bootstrap, global prefix, CORS, pipes, WebSocket adapter.
- `src/app.module.ts` — imports feature modules exported by platforms.
- `nest-cli.json`, `tsconfig.json`, `package.json`, `jest.config.js`,
  `.eslintrc.js`, `.npmrc`, `.env*.example`.

## Must not live here

- Controllers, services, policies, repositories, or DTOs. Those belong to their
  component's `backend/`.
- Business rules of any kind.
- Prisma access. That is `database/client` plus component repositories.
- Frontend code.

## What `app.module.ts` should look like

Composition only — a list of module imports, no logic:

```ts
@Module({
  imports: [
    WorkdayModule,     // from @apex/workforce/attendance/workday
    TicketsModule,     // from @apex/operations/tickets
    NotificationsModule,
  ],
})
export class AppModule {}
```

## Dependency direction

```
apps/api → platforms/*/backend (via public index.ts)
apps/api → shared/*
apps/api → database/client
```

`apps/api` must never import `platforms/*/frontend/**`.

## Migration status

Empty. Populated during Phases 1–5. API URLs and response shapes must not
change during any migration — `backend/` keeps serving production until each
module is moved and validated.
