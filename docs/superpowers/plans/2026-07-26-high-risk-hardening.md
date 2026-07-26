# High-Risk Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the highest-impact correctness and security failures found during the current Chatty review while preserving the existing API shape.

**Architecture:** Keep changes surgical. Backend point mutations will use a conditional atomic update inside the existing Prisma transaction; authentication will reject unsafe configuration and unsafe redirects; browser state will be namespaced and cleared on logout. Deployment packaging will explicitly exclude secrets and production images will retain the Prisma CLI needed for migrations.

**Tech Stack:** NestJS, Prisma, Next.js/React, Zustand, shell scripts, Docker.

---

### Task 1: Atomic point mutations and authorization hardening

**Files:**
- Modify: `backend/src/modules/points/points.service.ts`
- Modify: `backend/src/modules/auth/auth.service.ts`
- Modify: `backend/src/common/session.guard.ts`
- Modify: `backend/src/modules/auth/casdoor-oauth.service.ts`
- Modify: `backend/src/modules/admin/admin.service.ts`
- Test: `backend/test/points-and-auth.test.ts`

- [x] Write a failing test that proves a conditional debit rejects an insufficient balance without writing a negative balance, and that an unsafe OAuth `next` value normalizes to `/`.
- [x] Run the focused test and confirm the expected failures.
- [x] Implement the smallest conditional update and strict configuration/redirect checks; never reactivate an existing disabled admin during OAuth login.
- [x] Run the focused test, `npm run lint --prefix backend`, and `npm run build --prefix backend`.

### Task 2: Account-scoped browser state and logout behavior

**Files:**
- Modify: `src/store/useStore.js`
- Modify: `src/store/useImageStore.js`
- Modify: `src/app/profile/page.jsx`
- Modify: `src/components/layout/SettingsModal.jsx`
- Modify: `src/components/layout/Shell.jsx`
- Test: `src/lib/account-storage.test.js`

- [x] Write a failing test for account-keyed storage and logout cleanup.
- [x] Implement account-keyed persistence and wire both logout controls through the shared auth cleanup path.
- [x] Run the focused test and `npx next build --webpack`.

### Task 3: Deployment and production migration safety

**Files:**
- Modify: `scripts/deploy-remote.sh`
- Modify: `backend/Dockerfile`
- Modify: `scripts/deploy-prod.sh`
- Test: `scripts/deploy-remote.test.sh`

- [x] Add a shell assertion that the release archive excludes environment files and credentials.
- [x] Keep Prisma CLI available in the production migration image and run migration before replacing a healthy service where the existing compose flow permits it.
- [x] Run `sh -n scripts/*.sh` and the archive assertion.

### Task 4: Cross-surface verification

**Files:**
- No additional production files.

- [x] Review the combined diff for overlap with the pre-existing `schema.prisma` formatting change.
- [x] Run backend lint/build, frontend webpack build, Prisma validation, and shell syntax checks.
- [x] Report any database-dependent checks that remain unavailable without the configured PostgreSQL service.
