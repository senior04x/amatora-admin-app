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
