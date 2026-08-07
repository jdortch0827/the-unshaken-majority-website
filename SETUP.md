# Secure Direct Forms — One-Time Setup

The website code is complete, but the direct forms need three free services connected through Vercel environment variables. Configure the services before replacing the live website so there is no form downtime.

## 1. Create the Supabase project

1. Create a free project at `https://supabase.com/dashboard`.
2. Open **SQL Editor**, create a new query, paste everything from `setup/supabase.sql`, and run it.
3. Open **Project Settings → API**.
4. Copy:
   - Project URL → `SUPABASE_URL`
   - Publishable/anon key → `SUPABASE_ANON_KEY`
   - Server secret/service-role key → `SUPABASE_SERVICE_ROLE_KEY`
5. Never place the server secret/service-role key in HTML or public JavaScript. It belongs only in Vercel Environment Variables.

The SQL creates private tables and a private `case-evidence` bucket. Website visitors cannot browse the tables or attachments.

## 2. Create the Cloudflare Turnstile widget

1. Open `https://dash.cloudflare.com/` and choose **Turnstile**.
2. Add a widget named `The Unshaken Majority Forms`.
3. Use **Managed** mode.
4. Add the hostname `theunshakenmajority.com`. The root hostname also covers `www`.
5. Copy the site key and secret key:
   - Site key → `TURNSTILE_SITE_KEY`
   - Secret key → `TURNSTILE_SECRET_KEY`
6. Set `TURNSTILE_EXPECTED_HOSTNAME` to `www.theunshakenmajority.com`.

## 3. Create the Resend sender

1. Create a free account at `https://resend.com/`.
2. Add and verify `theunshakenmajority.com` as a sending domain.
3. Resend will provide DNS records. Because Vercel now controls the domain's nameservers, add those records in the Vercel domain DNS screen.
4. Create an API key and copy it to `RESEND_API_KEY`.
5. Use:
   - `RESEND_FROM` = `The Unshaken Majority <submissions@theunshakenmajority.com>`
   - `ADMIN_EMAIL` = `theunshakenmajority@gmail.com`

The `submissions@` address is a sending identity; it does not need to be a separate inbox. Replies from you can still come from the campaign Gmail account.

## 4. Add the Vercel environment variables

In the Vercel project, open **Settings → Environment Variables**. Add every variable from `.env.example` for **Production**. Preview deployments need separate Turnstile test keys or an approved preview hostname, so do not blindly copy the production Turnstile hostname restriction into Preview.

For `SUBMISSION_SIGNING_SECRET`, use a long random value of at least 32 characters. A password manager-generated 64-character password is suitable.

After saving the variables, redeploy the project.

## 5. Upload this complete website

Replace the repository contents with everything from this package, preserving the `api`, `assets`, and `setup` folders. Commit and let Vercel redeploy.

## 6. Check configuration

Open:

`https://www.theunshakenmajority.com/api/health`

Every check should show `true`, and `ready` should show `true`. The endpoint reports only whether variables exist; it never returns secret values.

## 7. Test both forms

1. Submit a contact message.
2. Confirm the success page shows a reference number.
3. Confirm the campaign Gmail receives the notification.
4. Confirm the sender receives a confirmation.
5. Submit a test case with one small image or PDF.
6. In Supabase, confirm:
   - the row appears under **Table Editor → case_submissions**;
   - the file appears under **Storage → case-evidence**;
   - the bucket is marked **Private**.
7. Delete the test records and files after testing.

## Free-plan expectations

This launch setup can operate on the providers' free tiers at modest traffic. Free quotas and provider terms can change, and Supabase free projects may pause after inactivity. Review usage periodically before the campaign grows or becomes commercial.
