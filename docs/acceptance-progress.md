# Deconstructor / Reconstructor Acceptance Progress

Status: BLOCKED for data-writing acceptance tests until DATABASE_URL target is verified.

## Verified infrastructure
- Working branch: `acceptance/deconstructor-reconstructor`. No production merge authorized.
- Separate Railway project `ayub-test-contentstudio` (`67f34f55-ea24-478b-8e73-73207b4c559f`) has environment `deconstructor-acceptance` (`6952033b-3b77-4363-a940-8cde04cbc797`).
- Acceptance frontend `genuine-consideration` and backend `pleasing-presence` report SUCCESS; both track `release/deconstructor-reconstructor-20261117`, not the new acceptance branch.
- Acceptance Postgres `Postgres-EB-O` reports SUCCESS and has its own volume `postgres-volume-iKKA`; backend has separate `pleasing-presence-volume`.
- Production lives in a different Railway project `SG-Content-Studio` (`7adba4dc-6fd7-47f4-b6ad-901bdcbca9d8`) with its own Postgres service and volumes.
- Both application backends have `DATABASE_URL` configured, but connected OAuth access redacts values. **Database URL identity has NOT been verified.** Distinct Postgres services alone do not prove the acceptance backend uses its local Postgres.
- No test writes, merges to main, or production deployments have been performed in this acceptance work.

## Next action
1. Verify acceptance backend `DATABASE_URL` references `Postgres-EB-O` and not production Postgres, without exposing credentials. Also verify uploads storage isolation.
2. Configure acceptance services to deploy from `acceptance/deconstructor-reconstructor` only after confirming their existing branch/source configuration and avoiding disruption to other tests.
3. Run six-stage Deconstructor, Reconstructor, save/reopen, audio/FFprobe export, and mobile acceptance. Record evidence after each stage and commit this log.
4. Fix defects on the acceptance branch only. Never merge into main or deploy production until explicit `push it` authorization.
