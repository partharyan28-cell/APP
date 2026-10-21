# Goodwork

Goodwork is a browser-based team rewards dashboard. The Supabase integration adds private invitee dashboards, owner-only email invitations, appeals for points, money, roles, and names, and comments between the owner and invitees.

## Supabase setup

1. Create a Supabase project and run [`supabase/migrations/20261021000100_invited_appeals.sql`](./supabase/migrations/20261021000100_invited_appeals.sql) in the SQL Editor.
2. In Supabase **Authentication → Users**, create your owner account. In the SQL Editor, promote that account (replace the email):

   ```sql
   update public.user_profiles
   set role = 'owner'
   where id = (
     select id from auth.users where lower(email) = lower('you@example.com')
   );
   ```

   This is a one-time administrative action. New accounts created by invitations receive the `invitee` role; only an owner can send invitations.
3. Copy the project URL and public anon key from **Project Settings → API** into `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of [`app.js`](./app.js). The anon key is intended for browser use; never put a service-role key in the browser.
4. Deploy the `invite-person` Edge Function from the repository root:

   ```sh
   supabase login
   supabase link --project-ref your-project-ref
   supabase secrets set APP_URL=https://your-app.example
   supabase functions deploy invite-person
   ```

   Install the Supabase CLI first if it is not already available. The function uses Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment variables. Add the app URL to **Authentication → URL Configuration → Redirect URLs**.
5. Configure email delivery under **Authentication → SMTP Settings**. Supabase’s built-in mail service is suitable for testing; production invitations should use an SMTP service with appropriate sending limits. Gmail and iCloud addresses can receive the invitation and sign-in links.
6. Serve the app from the configured origin over HTTPS (or localhost for development). Sign in as the owner, add team members with their email addresses, and select **Invite** beside a person. Invitees open their email link to access their own dashboard.

The database policies restrict team records to the owner and each invitee’s own record. Invitees can create appeals about their points, money, role, or name and comment on their appeals. The owner can review appeals, change their status, and comment. Invitation authorization is checked by the Edge Function as well as hidden from invitee UI.

Do not share Supabase service-role keys, SMTP credentials, or email app passwords in chat or commit them to the repository.