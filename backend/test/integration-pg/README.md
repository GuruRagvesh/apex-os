# PostgreSQL-backed integration tests

These suites run against a real PostgreSQL 18 server. They take real advisory
locks, run the real attendance evaluator, and check what actually landed in the
tables. They exist because the mocked suites proved the code agreed with itself,
which is a different claim from the database agreeing with it — and the first
thing they found was a month lock that threw on every call.

They are **not** part of `npm test`. Ordinary unit CI must never require a
developer's production-like database.

## Running them

They refuse to start unless `DATABASE_URL` names an isolated database. Two gates,
both fail closed: the connection string is checked (loopback host, the dedicated
database name, nothing matching `render.com` / `prod` / `staging`), and then the
**server is asked who it is**, because a URL states an intention and only the
server states a fact.

Create a throwaway cluster — one that did not exist before the command and
contains only what the tests put in it:

```bash
initdb -D "$SCRATCH/pg/data" -U apex_test --auth-local=trust --auth-host=trust --encoding=UTF8 --locale=C
```

Then set `port = 55432`, `listen_addresses = '127.0.0.1'` and `timezone = 'UTC'`
in `postgresql.conf`, start it, and create the database:

```bash
pg_ctl -D "$SCRATCH/pg/data" -l "$SCRATCH/pg/server.log" start
createdb -h 127.0.0.1 -p 55432 -U apex_test apex_os_attendance_integration
```

Apply the schema and run:

```bash
DATABASE_URL="postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration?schema=public" npx prisma migrate deploy
```

```bash
DATABASE_URL="postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration?schema=public" npm run test:int
```

Never `prisma db push`. Never `prisma migrate reset`. Never a URL you did not
build yourself for this purpose.

## Why one worker

`maxWorkers: 1`. These suites share one database and several deliberately create
lock contention; parallel workers would produce failures that say nothing about
the code.

## What is real and what is not

Real: Prisma, the NestJS injector, the attendance evaluator, the advisory locks,
every transaction boundary.

Substituted: the object vault (R2) and the mail transport — the two dependencies
that leave the machine. Both record what they were asked to do, so a test can
still assert that an object key was built from the batch id rather than a
user-supplied filename, or that a report delivery was attempted. **No message is
ever handed to a real transport, and `g1-close-contention` asserts that.**

## Fixtures

Entirely synthetic, and obviously so: `Employee A`…`Employee F`, ids in a
`TE-9xx` series outside any real one, `@integration.invalid` addresses. No
production data is copied, and no capture evidence is invented — a fixture day
carries punch evidence rows with no latitude, no photo and no device metadata,
because `DailyAttendance` is derived and a day written without a source behind
it describes something that cannot exist.
