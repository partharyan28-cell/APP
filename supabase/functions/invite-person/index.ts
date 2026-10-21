import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return jsonResponse(401, { error: 'Sign in before sending an invitation.' });

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectUrl || !anonKey || !serviceRoleKey) {
    console.error('Required Supabase function environment variables are missing.');
    return jsonResponse(500, { error: 'Invitation service is not configured.' });
  }

  const userClient = createClient(projectUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const accessToken = authorization.slice('Bearer '.length);
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonResponse(401, { error: 'Your sign-in session is invalid or expired.' });

  const { data: profile, error: profileError } = await userClient
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error('Could not verify invitation permission:', profileError.message);
    return jsonResponse(500, { error: 'Could not verify invitation permission.' });
  }
  if (profile?.role !== 'owner') return jsonResponse(403, { error: 'Only the workspace owner can invite team members.' });

  let requestBody: { personId?: unknown };
  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be valid JSON.' });
  }
  if (typeof requestBody.personId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestBody.personId)) {
    return jsonResponse(400, { error: 'A valid team member ID is required.' });
  }

  const adminClient = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: person, error: personError } = await adminClient
    .from('team_people')
    .select('id, email, user_id, invited_at, accepted_at')
    .eq('id', requestBody.personId)
    .maybeSingle();
  if (personError) {
    console.error('Could not load invitation recipient:', personError.message);
    return jsonResponse(500, { error: 'Could not load the team member.' });
  }
  if (!person?.email) return jsonResponse(404, { error: 'Team member or email address not found.' });
  if (person.accepted_at) return jsonResponse(409, { error: 'This team member has already accepted an invitation.' });

  const { error: markInvitedError } = await adminClient
    .from('team_people')
    .update({ invited_at: new Date().toISOString() })
    .eq('id', person.id)
    .is('user_id', null);
  if (markInvitedError) {
    console.error('Could not prepare team invitation:', markInvitedError.message);
    return jsonResponse(500, { error: 'Could not prepare the invitation.' });
  }

  const appUrl = Deno.env.get('APP_URL');
  const inviteResult = person.user_id
    ? await adminClient.auth.admin.resend({
      type: 'invite',
      email: person.email,
      options: appUrl ? { emailRedirectTo: appUrl } : undefined
    })
    : await adminClient.auth.admin.inviteUserByEmail(person.email, {
      ...(appUrl ? { redirectTo: appUrl } : {}),
      data: { team_person_id: person.id }
    });
  const inviteError = inviteResult.error;
  if (inviteError) {
    console.error('Supabase could not send the invitation:', inviteError.message);
    return jsonResponse(502, { error: 'The invitation email could not be sent. Check Supabase Auth email settings and try again.' });
  }

  return jsonResponse(200, { sent: true });
});
