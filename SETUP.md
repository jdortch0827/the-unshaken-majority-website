# Investigation Publishing System Setup

This package preserves the existing website and direct-submission system while adding the complete investigations archive, public case template, correction requests, private evidence handling, and protected administrator workspace.

## 1. Existing environment variables

Keep the environment variables already configured in Vercel:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_EXPECTED_HOSTNAME`
- `SUBMISSION_SIGNING_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `ADMIN_EMAIL`
- `SITE_URL`

No new environment variable is required for the investigations system.

## 2. Apply the database migration

In Supabase, open **SQL Editor → New query**. Copy all of `setup/002_investigations.sql`, paste it into the editor, and click **Run**.

The migration is designed to run after `setup/supabase.sql`. It creates the investigation tables, unique case-number generator, audit records, correction requests, private `investigation-evidence` bucket, indexes, row-level security, and the unpublished Coca-Cola draft.

Expected result: **Success. No rows returned.**

## 3. Create the first administrator

1. In Supabase, open **Authentication → Users**.
2. Click **Add user** and create the administrator using a private email and strong password.
3. Copy the user's UUID.
4. Open `setup/003_bootstrap_admin.sql.example`.
5. Replace `REPLACE_WITH_AUTH_USER_UUID` with the copied UUID.
6. Run the statement in Supabase SQL Editor.

Supported roles:

- `admin`: full editing, approval, publishing, archive, withdrawal, case-number override, and unpublished-draft deletion
- `editor`: create and edit drafts, upload evidence, and submit for review
- `reviewer`: review, approve, publish, unpublish, archive, and withdraw

## 4. Deploy

Upload every file in this package to the existing GitHub repository, replacing matching files. Vercel will install the Supabase JavaScript dependency and redeploy automatically.

After the deployment is Ready, test:

- `/investigations`
- `/standards`
- `/admin/login`
- `/api/health`

Unpublished drafts and admin pages are marked noindex and are not returned by public investigation APIs.

## 5. Open the administrator dashboard

Go to:

`https://www.theunshakenmajority.com/admin/login`

Sign in with the Supabase Authentication user created above. Successful sign-in redirects to:

`https://www.theunshakenmajority.com/admin/investigations`

## 6. Upload the Coca-Cola evidence

1. Open the dashboard and select `UM-2026-001`.
2. Open section **6. Evidence**.
3. Find **Exhibit A — Pride phrase testing** and click **Fill Exhibit Slot**.
4. Choose the actual recording or screenshot, verify the exhibit metadata, select the intended visibility, and click **Upload Exhibit File**.
5. Repeat for:
   - Exhibit B — Power phrase testing
   - Exhibit C — Additional wording testing
   - Exhibit D — Personalized products shown as out of stock
6. Keep evidence **Private** or **Internal Review Only** until it is intentionally cleared for publication.
7. For a public image, supply useful alt text. For public video or audio, supply a transcript or captions when available.
8. Click **Save Draft** after reviewing all metadata.

The original file remains private. Images receive an optimized WebP public preview while the original is preserved. An uploaded original cannot be silently overwritten; replacement requires an audited removal and a new exhibit upload.

## 7. Review and publish UM-2026-001

Before publishing:

1. Review the title, case summary, exact claim, standard, methodology, comparisons, supported statement, and limitations.
2. Confirm the right-of-response status is accurate. Do not select **Declined to Respond** unless the company actually declined.
3. Add at least one structured source.
4. Mark at least one real evidence exhibit **Public** and ensure it has an uploaded file or an original source URL.
5. Review the preliminary finding and any remaining questions.
6. Add a bottom-line statement and SEO description if desired.
7. Click **Save Draft**.
8. Click **Preview** and review the complete protected case page.
9. Click **Submit for Internal Review**.
10. An `admin` or `reviewer` clicks **Approve Investigation**.
11. After final review, click **Publish Investigation**.

The public page will then be available at:

`https://www.theunshakenmajority.com/investigations/coca-cola-custom-can-filter`

The archive and homepage Latest Investigation card update automatically.

## 8. Corrections and material changes

Every published investigation includes **Report an Error**. Requests appear in the protected dashboard and do not alter public content automatically.

Any material change to published case content, status, right-of-response information, evidence metadata, comparisons, supported findings, limitations, sources, or the formal finding requires explicit confirmation and a public explanation. Previous wording and findings are preserved in revision history, and the appropriate public update entry is created.

Published cases should normally be archived or withdrawn, not deleted. Permanent deletion is restricted to an administrator and only applies to a never-published draft.

## 9. Validation commands

With dependencies installed:

```bash
npm run check
```

Individual checks:

```bash
node scripts/validate.mjs
npm run check:syntax
npm test
```
