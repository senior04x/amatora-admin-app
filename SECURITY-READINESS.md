# Admin app: release security audit

Status: not cleared for production release. Source audit plus partial live RLS inspection; database grants and effective access have not yet been verified. No production records or policies were changed.

## Confirmed source findings

- `src/screens/AccountScreen.tsx:323`: organizer creation writes the submitted password directly to `organization_users.password`. LoginScreen (135, 159) and WelcomeScreen (141, 165) compare passwords directly through database queries. Removing these paths before existing admins are migrated could lock them out.
- `src/context/OrgContext.tsx:141`: cached organization ID and role are treated as authority. Missing/unknown roles become `org_admin`; the unresolved-organization ID 1 fallback has been removed on feature/block-missing-organization. UI role checks cannot replace database authorization.
- `src/screens/AccountScreen.tsx:286`: organizer listing selects every column, which can include the password column. Use explicit non-sensitive columns after confirming the schema. Organizer deletion (355) has only an ID filter; database authorization must enforce organization ownership.
- `src/supabaseClient.ts:12` stores authentication sessions in AsyncStorage. `src/utils/securePin.ts:19` falls back to plaintext PIN storage on secure-storage failure.

## Database evidence requiring live verification

`../amatora-organization/fix_admin.sql:1` defines authenticated full access on teams with unconditional USING/WITH CHECK. `setup.sql:39` defines anonymous application reads with unconditional USING. These files are evidence of proposed/historical policies, not proof of current production exposure. Inspect live pg_policies, RLS flags, table/column grants and SECURITY DEFINER functions before drawing a live-security conclusion.

## Safe next stage

1. Read only live authorization metadata; do not export personal records/passwords.
2. Inventory existing authentication methods and dependent web/admin clients before changing login.
3. Prepare isolated test fixtures and verify no-session denial, cross-organization denial, ordinary-user denial and valid-admin access.
4. Design migration and rollback for existing admins. Confirm backup and recovery before any production migration.
5. Release only after authorization checks and physical-device validation. Store-review privacy declarations and a restricted reviewer account remain necessary.

## Checks completed

- TypeScript: `npx tsc --noEmit` passed.
- Android JavaScript export passed; this does not validate database permissions or a native Play Store build.
- `npx expo install --check` reported four Expo package version mismatches.
- No dummy accounts, notification endpoints or production mutations were invoked.

## Missing-organization fix

Missing or malformed organization IDs now block admin screens, organization requests and subscriptions. Organization-ID defaults to customer 1 were removed across screens and query hooks. Valid organization 1 remains supported. This client-side guard does not replace server authorization; cached ID/role trust and live RLS still require the next audit stage. No production deployment was performed.

## Live RLS inspection — 2026-10-02

Project: xzzyhfyazwohdqqbjiiy, main production. Inspected policy definitions in Supabase Dashboard only; no policy was saved, no customer rows were retrieved, and no mutation or notification endpoint was invoked.

| Table | Policy | Verified definition | Priority |
| --- | --- | --- | --- |
| organization_users | Allow all access to organization_users (19120) | PERMISSIVE ALL TO public USING (true) WITH CHECK (true) | Critical: no organization or identity check at policy layer |
| admin_users | Allow read admin_users (18499) | PERMISSIVE SELECT TO anon, authenticated USING (true) | Critical: no row restriction at policy layer; verify column grants, especially password |
| matches | Enable all access for authenticated users (17953) | PERMISSIVE ALL TO public USING (auth.role() = 'authenticated'::text), no explicit WITH CHECK | High: authenticated access is not scoped to an organization |

These definitions are verified live, but actual API exposure also depends on table/column grants and other restrictive policies. No exploit against customer data was attempted. Do not infer exposure solely from policy names.

The mobile LoginScreen and WelcomeScreen still query password fields directly in organization_users/admin_users as a fallback. Removing public access before replacing those fallback paths can lock out existing administrators. Existing organization-scoped permissive policies must be assessed together with broad permissive policies; adding another scoped permissive policy is not sufficient to narrow a broader one.

Next bounded stage: read only pg_policies, table/column privileges, RLS flags, identity mapping columns and relevant SECURITY DEFINER function definitions. Then prepare an isolated two-organization authorization test and login migration/rollback plan before production policy changes. Do not export passwords, tokens, emails or personal customer rows.

## Live grants and identity metadata — 2026-10-02

Read-only catalog queries executed in BEGIN READ ONLY transactions with a 5-second statement timeout. No business-table rows or credential values were selected.

- admin_users, organization_users and matches: RLS enabled, not forced; anon and authenticated have table SELECT/INSERT/UPDATE/DELETE grants. Grants alone do not bypass RLS.
- organization_users.password: anon and authenticated both have column SELECT privilege. Combined with its public ALL/true permissive policy and absence of restrictive policies, this table is not protected from those roles at the database authorization layer. No password values were read.
- admin_users: no password column exists in the live schema; the app's fallback password query against this table is incompatible with the live schema. Its two policies allow public reads and unrestricted authenticated management.
- All policies on these three tables are PERMISSIVE. Broad access remains effective alongside narrower organization policies.
- get_user_org_id() is STABLE SECURITY DEFINER, search_path public/pg_temp. It maps JWT email to organization_users.email with LIMIT 1, then falls back to organizations.admin_email. Since organization_users is publicly writable, this mapping source is not trustworthy. Email uniqueness and authentication ownership still need verification.

## Required next implementation stage

1. Inventory web/admin-app account creation and login dependencies. Do not silently disable working login fallbacks.
2. Prepare server-verified admin identity tied to an immutable auth user ID; ordinary clients must not create or modify authoritative organization/role mappings. Organizer invitations/creation must be authorized server-side.
3. Replace direct password queries with authenticated login and derive organization/role from trusted server identity. Existing organizer accounts need a planned migration; never copy plaintext passwords to new app code or logs.
4. Prepare scoped policies and removal of broad overlapping policies together with tests: anonymous credential/membership read denial, anonymous mutation denial, cross-organization mutation denial, valid own-organization admin operations and intended public football reads.
5. Verify recovery backup and rollback before a coordinated rollout. No production policy change has been made in this audit stage.

## Client password-list containment and login inventory

- Mobile organizer lists and OrgContext current-user loading now select explicit profile fields without password. Password values are no longer displayed in the two organizer lists. This reduces exposure in the normal UI but does not repair database permissions. Login fallback queries and explicit credential-edit paths remain pending coordinated migration.
- Web admin Login.jsx uses Supabase Auth. Organizations.jsx invokes auth.admin.createUser from client code and then inserts admin_users; creation must move behind server authorization. No actual account was created during this audit.
- Web OrgContext.jsx trusts user_metadata role/organization as a fallback and defaults to organization 1. This separate web path remains unfixed; mobile changes do not protect it. It must be addressed in its repository as the next bounded code task.
- Existing mobile organizer creation writes organization_users.password directly and does not create a corresponding Auth identity. Therefore deleting fallback login alone would lock these accounts out.

Coordinated migration order: first implement a server-authorized organizer provisioning endpoint and immutable Auth UID membership; migrate existing organizers using a deliberate activation/reset flow without copying passwords; update mobile/web identity resolution; verify isolated authorization tests; then remove broad database policies and legacy password paths in one controlled release.

## Verified mobile administrator organization (local, undeployed)

LoginScreen Auth-success admin branch now queries admin_users by authenticated user ID rather than organizations.admin_email. OrgContext admin branch calls Auth getUser, reads id/role/organization_id by verified UID and ignores cached organization for authority. A missing/invalid mapping fails closed; customer one is a valid exact mapping, never a fallback. Four offline helper/ID tests and TypeScript check pass. No login, location notification, account or production operation was invoked during tests.

Release prerequisites: inventory legitimate Auth administrators and their admin_users UID mappings before deployment; administrators without mappings will be blocked. admin_users still permits client writes in production, so verified lookup alone is not secure until its grants/policies are repaired. Legacy organizer role=user path still relies on cache/email/password and must be migrated; local role switching to that path is not yet a secure boundary. Existing direct-password fallbacks remain undeployed migration work. Do not claim production readiness or release this partial migration.

Correction to earlier web notes: separate organization repository commits removed web identity fallback and prepared server creation/edit code. Its Organizations.jsx is currently not routed. Those findings do not mean mobile organizers or live database policies are fixed.

Manual UI verification after coordinated migration: npx expo start from amatora-admin-app; use isolated fixture accounts only. Confirm valid admin restores its exact organization, missing membership blocks data, and altered cached organization cannot change the admin's organization. Device UI verification has not been performed.

## Active account editor no longer fetches/prefills stored passwords

AccountScreen initializes password input empty and clears it plus visibility when editing closes. Account profile query now selects id/organization_id/full_name/email/avatar_url and filters the current organization; it does not retrieve stored credentials. The UI labels the new-password field optional and explains leaving it blank retains the existing password. This does not change or remove existing login credentials. TypeScript and the four existing ID/membership tests pass (those tests do not verify device UI). No test account or production data was created, updated or deleted.

Legacy credential writes and plaintext organizer creation still exist and remain release blockers. This is exposure containment only, not completed Auth migration. Manual local verification: npx expo start, open Account edit with an isolated fixture, confirm password is empty, close/reopen after typing without saving and confirm input/eye reset. Do not save production credential changes as a test.
