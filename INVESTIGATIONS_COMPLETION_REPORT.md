# The Unshaken Majority Investigations Publishing System

## Completion Report

### 1. Summary

The existing static Vercel/Supabase website has been extended with a structured investigations publishing system while preserving the current brand, navigation, direct contact form, case-submission system, and mobile layouts.

The implementation includes:

- Public investigations archive, search, filtering, pagination, and case pages
- Server-rendered investigation metadata for SEO and social sharing
- Hidden homepage Latest Investigation card that appears only when a published case exists
- Protected Supabase-authenticated administrator dashboard and form-based editor
- Draft, internal review, approval, publication, unpublication, archive, withdrawal, duplication, and revision controls
- Structured evidence, comparison, source, response, finding, question, update, assignment, tag, and audit records
- Private evidence storage with signed uploads and signed previews
- Public correction-request workflow tied to a case
- Permanent corrections and update history
- Unique non-reusable `UM-YYYY-###` case numbering
- Unpublished administrator draft for `UM-2026-001 — Coca-Cola’s Custom Can Filter`

### 2. Files added or changed

#### Public pages and client code

- `index.html`
- `investigations.html`
- `investigation.html`
- `investigations.js`
- `latest-investigation.js`
- `standards.html`
- `submit.html`
- `script.js`
- `correction.html`
- `correction.js`
- `privacy.html`
- `contact.html`
- `404.html`
- `styles.css`
- `robots.txt`

#### Administrator pages and client code

- `admin-login.html`
- `admin-investigations.html`
- `admin-investigation-editor.html`
- `admin-preview.html`
- `admin.js`
- `admin.css`

#### Public APIs

- `api/investigations.js`
- `api/investigation.js`
- `api/investigation-page.js`
- `api/latest-investigation.js`
- `api/sitemap.js`
- `api/prepare-correction.js`
- `api/finalize-correction.js`

#### Administrator APIs

- `api/admin-session.js`
- `api/admin-investigations.js`
- `api/admin-investigation.js`
- `api/admin-evidence.js`
- `api/admin-corrections.js`

#### Existing submission APIs updated

- `api/prepare-case.js`
- `api/finalize-case.js`

#### Shared server code

- `server/investigations.js`

#### Database and administrator bootstrap

- `setup/002_investigations.sql`
- `setup/003_bootstrap_admin.sql.example`

#### Configuration, documentation, and validation

- `vercel.json`
- `package.json`
- `README.md`
- `SETUP.md`
- `INVESTIGATIONS_COMPLETION_REPORT.md`
- `scripts/validate.mjs`
- `scripts/test-investigations.mjs`

### 3. Database migrations

`setup/002_investigations.sql` creates the complete investigation schema, indexes, triggers, row-level security, privileges, case-number generator, private evidence bucket, categories, and the unpublished Coca-Cola draft.

`setup/003_bootstrap_admin.sql.example` is a controlled one-time template for assigning the first Supabase Authentication user an administrator role.

### 4. New routes

#### Public

- `/investigations`
- `/investigations/:slug`
- `/standards`
- `/correction?case=UM-YYYY-###`
- `/sitemap.xml`

#### Administrator

- `/admin/login`
- `/admin/investigations`
- `/admin/investigations/new`
- `/admin/investigations/:id/edit`
- `/admin/investigations/:id/preview`

#### APIs

- `/api/investigations`
- `/api/investigation`
- `/api/investigation-page`
- `/api/latest-investigation`
- `/api/admin-session`
- `/api/admin-investigations`
- `/api/admin-investigation`
- `/api/admin-evidence`
- `/api/admin-corrections`
- `/api/prepare-correction`
- `/api/finalize-correction`
- `/api/sitemap`

### 5. New database tables

- `admin_profiles`
- `investigation_case_counters`
- `investigation_categories`
- `investigation_tags`
- `investigations`
- `investigation_sections`
- `investigation_comparisons`
- `investigation_assertions`
- `investigation_evidence`
- `investigation_sources`
- `investigation_questions`
- `investigation_responses`
- `investigation_findings`
- `investigation_updates`
- `investigation_revisions`
- `investigation_assignments`
- `investigation_tag_links`
- `investigation_audit_logs`
- `correction_requests`
- `correction_attachments`

The migration also adds `related_case_number` to the existing `case_submissions` table.

### 6. Storage bucket and controls

The migration creates the private `investigation-evidence` bucket with:

- 50 MB per-file limit
- Restricted file types for images, video, audio, PDF, office documents, text, and CSV
- No anonymous direct read access
- Signed upload and signed preview/download flows through protected server APIs
- Public visibility only after an administrator intentionally marks an exhibit public
- Visibility states for Public, Private, Internal Review Only, Withheld for Privacy, and Withheld for Legal or Safety Reasons
- Safe generated filenames and case/evidence-specific storage paths

### 7. Environment variables

No additional environment variables are required beyond the variables already used by the secure direct-form website:

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

### 8. Validation commands run

```bash
npm run check
```

This runs:

```bash
node scripts/validate.mjs
npm run check:syntax
npm test
```

### 9. Validation results

- Required-file validation: PASS
- Internal route and asset-reference validation: PASS
- Duplicate HTML ID validation: PASS
- Admin noindex validation: PASS
- Secret-pattern scan: PASS
- Vercel rewrite validation: PASS
- Investigation SEO metadata-marker validation: PASS
- JavaScript syntax checks: PASS
- Automated tests: 5 passed, 0 failed
  - Slug generation
  - Rich-text sanitization
  - Unsafe attribute/element removal
  - Evidence file validation
  - Case-isolated evidence paths

The production migration and authenticated workflow require the manual deployment steps below because this package does not possess or expose the live Supabase or Vercel secrets.

### 10. Remaining manual steps

1. Back up the live Supabase database.
2. Run `setup/002_investigations.sql` in Supabase SQL Editor.
3. Create the first administrator in Supabase Authentication.
4. Run the adjusted statement from `setup/003_bootstrap_admin.sql.example` using that user’s UUID.
5. Upload this complete package to the existing GitHub repository and allow Vercel to redeploy.
6. Sign in to the administrator dashboard and perform the live workflow checks listed in `SETUP.md`.
7. Upload the real Coca-Cola evidence and review every public/private visibility setting.
8. Contact Coca-Cola when ready and record the actual response status accurately.
9. Add at least one real structured source before publication.
10. Preview, review, approve, and intentionally publish the investigation.

### 11. Open the administrator dashboard

After deployment:

1. Go to `https://www.theunshakenmajority.com/admin/login`.
2. Sign in with the Supabase Authentication account whose UUID was added to `admin_profiles`.
3. The site redirects to `https://www.theunshakenmajority.com/admin/investigations`.

### 12. Upload the Coca-Cola evidence

1. Open `UM-2026-001` from the administrator dashboard.
2. Open **6. Evidence**.
3. Select the matching empty exhibit slot.
4. Click **Fill Exhibit Slot**.
5. Review the exhibit label, title, description, type, date, source, authenticity note, download setting, and visibility.
6. Click **Upload Exhibit File** and select the real screenshot or recording.
7. Keep material Private or Internal Review Only until it is cleared for publication.
8. Repeat for Exhibits A through D.
9. Save the draft and open Preview.

An uploaded original cannot be silently overwritten. A replacement requires an audited removal and a new exhibit upload.

### 13. Review and publish UM-2026-001

1. Verify the supplied comparisons use **Allowed to proceed**, not **Approved**.
2. Confirm the methodology accurately distinguishes the initial automated filter from final review, manufacturing, or shipment.
3. Verify the required limitations remain visible.
4. Record the right-of-response status truthfully; do not use Declined to Respond unless Coca-Cola expressly declines.
5. Add real sources and upload the actual exhibits.
6. Mark only intentionally publishable evidence Public.
7. Save and Preview.
8. Select **Submit for Internal Review**.
9. An administrator or reviewer selects **Approve Investigation**.
10. Complete the required publication validation and select **Publish Investigation**.
11. Confirm the public page, archive, homepage Latest Investigation card, sitemap, correction form, and additional-evidence link.

The public URL will be:

`https://www.theunshakenmajority.com/investigations/coca-cola-custom-can-filter`
