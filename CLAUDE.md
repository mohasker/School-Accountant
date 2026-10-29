# CLAUDE.md — MOESAS (نظام محاسبي المدارس الحكومية)

Read `docs/HANDOVER-ar.md` first: project, workflow, structure, decisions so far and the open tasks ("أين توقفنا").

## Rules
- Work and push only on branch `claude/vibrant-bell-tj6ext`. Do not create releases or tags; the owner does that on GitHub.
- Reply to the owner in Egyptian Arabic, step by step; the owner is an accountant, not a developer.
- Approved official forms (certificate, cover letter, assignment letter, quote report, imprest statement, budget estimate): formatting changes only unless the owner asks. No watermark, no footer, never a QR code.
- Real people's names only in `scripts/seed-people.local.json` (gitignored). Trial data is synthetic or derived from the approved workbooks.
- Trial passwords: admin accounts `Madar-Trial-2026`; shared trial account `زائر` / `guest` with `112233` (trial only).
- Keep the launcher name `Start-Madar.bat`. Never put AI model names in commits, code or PRs.
- Inside `transact()` use the transaction client `t`, never the global `db`.

## Commands
- `npm ci && npx prisma generate`
- Typecheck: `npx tsc --noEmit -p apps/api/tsconfig.json` and `npx tsc --noEmit -p apps/web/tsconfig.json`
- Tests: `npm test` (all must pass); one test: `node --import tsx --test --test-name-pattern="NAME" tests/system.test.ts`
- Build: `npm run build`, then restore: `git checkout apps/web/tsconfig.json apps/web/tsconfig.tsbuildinfo apps/api/tsconfig.json apps/web/next-env.d.ts`
- Trial: `DEMO_PASSWORD=Madar-Trial-2026 npm run demo` → http://localhost:3000
- Format: `npx prettier --write <files>`

## Release checklist
Bump `VERSION` and `APP_VERSION` (`apps/web/lib/brand.ts`); add a line to `docs/development-line.md`; refresh `docs/test-results.txt` and the test count in `README.md` and `docs/release-readiness.md`; update `docs/HANDOVER-ar.md` (version, open tasks); commit, push, and update the PR #1 title.
