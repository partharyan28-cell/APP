import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fcpwjfqddycbfhlrxzqu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KeQCftOl3Xcc41OkVb_qGg_1DPBHF2E';
const configured = !SUPABASE_URL.includes('YOUR_PROJECT_ID') && !SUPABASE_ANON_KEY.includes('YOUR_');
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const moneyFormat = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const numberFormat = new Intl.NumberFormat();
const palette = ['#e2efdb', '#fbe8dc', '#e0ebf5', '#f2e5ef', '#f4edd7', '#dff0ed'];
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
const getWeekKey = (date = new Date()) => {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((day - yearStart) / 86400000) + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

let user = null;
let userRole = null;
let data = { people: [], activity: [], appeals: [], comments: [] };
let editingId = null;
let rewardPersonId = null;
let toastTimer;

function setScreen(screenId) {
  ['authScreen', 'setupScreen', 'loadingScreen', 'ownerApp', 'inviteeApp'].forEach(id => {
    $(`#${id}`).hidden = id !== screenId;
  });
}

function setToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function reportError(error) {
  console.error(error);
  const message = error?.message || 'Something went wrong. Please try again.';
  if (!$('#loadingScreen').hidden) setScreen('authScreen');
  if ($('#authScreen').hidden === false) {
    $('#authError').textContent = message;
    $('#authError').hidden = false;
  } else {
    setToast(message);
  }
}

async function runSafely(action) {
  try {
    await action();
  } catch (error) {
    reportError(error);
  }
}

function throwIfError({ error }) {
  if (error) throw error;
}

function closeOverlay(id) {
  const overlay = $(`#${id}`);
  overlay.classList.remove('open');
  if (!document.querySelector('.overlay.open')) document.body.style.overflow = '';
}

function openOverlay(id) {
  document.querySelectorAll('.overlay').forEach(element => element.classList.remove('open'));
  $(`#${id}`).classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $(`#${id} input:not([type=hidden]):not([disabled])`)?.focus(), 30);
}

function addActivity(entry) {
  data.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), owner_id: user.id, ...entry });
  data.activity = data.activity.slice(0, 60);
}

async function saveOwnerData() {
  const people = data.people.map(person => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    salary: person.salary,
    points: person.points || 0,
    money: person.money || 0,
    paid_week: person.paidWeek || null
  }));
  if (people.length) {
    const result = await supabase.from('team_people').upsert(people);
    throwIfError(result);
  }
  const activity = data.activity.map(item => ({
    id: item.id,
    owner_id: user.id,
    person_id: item.personId || null,
    person_name: item.personName,
    kind: item.kind,
    amount: item.amount,
    note: item.note || '',
    created_at: item.at
  }));
  if (activity.length) {
    const result = await supabase.from('team_activity').upsert(activity);
    throwIfError(result);
  }
}

async function loadOwnerData() {
  const [peopleResult, activityResult, appealsResult] = await Promise.all([
    supabase.from('team_people').select('*').order('created_at'),
    supabase.from('team_activity').select('*').order('created_at', { ascending: false }).limit(60),
    supabase.from('appeals').select('*').order('created_at', { ascending: false })
  ]);
  throwIfError(peopleResult);
  throwIfError(activityResult);
  throwIfError(appealsResult);
  data.people = peopleResult.data.map(person => ({
    id: person.id,
    name: person.name,
    email: person.email,
    role: person.role,
    salary: Number(person.salary),
    points: Number(person.points),
    money: Number(person.money),
    paidWeek: person.paid_week,
    userId: person.user_id,
    invitedAt: person.invited_at,
    acceptedAt: person.accepted_at
  }));
  data.activity = activityResult.data.map(item => ({
    id: item.id,
    personId: item.person_id,
    personName: item.person_name,
    kind: item.kind,
    amount: Number(item.amount),
    note: item.note,
    at: item.created_at
  }));
  data.appeals = appealsResult.data;
  await loadComments();
}

async function loadInviteeData() {
  const personResult = await supabase.from('team_people').select('*').eq('user_id', user.id).maybeSingle();
  throwIfError(personResult);
  if (!personResult.data) throw new Error('Your invited team profile was not found. Ask the workspace owner to check your invitation.');
  data.people = [{
    id: personResult.data.id,
    name: personResult.data.name,
    email: personResult.data.email,
    role: personResult.data.role,
    salary: Number(personResult.data.salary),
    points: Number(personResult.data.points),
    money: Number(personResult.data.money),
    paidWeek: personResult.data.paid_week
  }];
  const appealsResult = await supabase.from('appeals').select('*').eq('person_id', personResult.data.id).order('created_at', { ascending: false });
  throwIfError(appealsResult);
  data.appeals = appealsResult.data;
  data.activity = [];
  await loadComments();
}

async function loadComments() {
  if (!data.appeals.length) {
    data.comments = [];
    return;
  }
  const result = await supabase.from('appeal_comments')
    .select('*')
    .in('appeal_id', data.appeals.map(appeal => appeal.id))
    .order('created_at');
  throwIfError(result);
  data.comments = result.data;
}

async function loadDashboard(authUser) {
  user = authUser;
  setScreen('loadingScreen');
  const profileResult = await supabase.from('user_profiles').select('role').eq('id', user.id).single();
  throwIfError(profileResult);
  userRole = profileResult.data.role;
  if (userRole === 'owner') {
    await loadOwnerData();
    $('#todayLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    renderOwner();
    setScreen('ownerApp');
    return;
  }
  if (userRole !== 'invitee') throw new Error('This account does not have workspace access.');
  await loadInviteeData();
  renderInvitee();
  setScreen('inviteeApp');
}

function paidPeople() {
  return data.people.filter(person => person.paidWeek === getWeekKey());
}

function renderOwner() {
  const totalSalary = data.people.reduce((sum, person) => sum + Number(person.salary || 0), 0);
  const paid = paidPeople();
  $('#payrollTotal').textContent = moneyFormat.format(totalSalary);
  $('#paidTotal').textContent = moneyFormat.format(paid.reduce((sum, person) => sum + Number(person.salary || 0), 0));
  $('#paidFoot').textContent = `${paid.length} of ${data.people.length} ${data.people.length === 1 ? 'person' : 'people'} paid`;
  $('#pointsTotal').textContent = numberFormat.format(data.people.reduce((sum, person) => sum + Number(person.points || 0), 0));
  $('#peopleTotal').textContent = numberFormat.format(data.people.length);
  $('#rosterCount').textContent = `${data.people.length} ${data.people.length === 1 ? 'person' : 'people'}`;
  renderFilters();
  renderRoster();
  renderActivity();
  renderAppeals(true);
}

function renderFilters() {
  const filter = $('#roleFilter');
  const previous = filter.value;
  const roles = [...new Set(data.people.map(person => person.role.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  filter.innerHTML = '<option value="">All roles</option>' + roles.map(role => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join('');
  if (roles.includes(previous)) filter.value = previous;
}

function renderRoster() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const role = $('#roleFilter').value;
  const visible = data.people.filter(person =>
    (!role || person.role === role) &&
    (!query || person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query) || person.role.toLowerCase().includes(query))
  );
  $('#rosterBody').innerHTML = visible.map((person, index) => {
    const isPaid = person.paidWeek === getWeekKey();
    const balance = Number(person.money || 0);
    const invitationLabel = person.acceptedAt ? 'Joined' : person.invitedAt ? 'Resend invite' : 'Invite';
    const invitationDisabled = person.acceptedAt ? 'disabled' : '';
    return `<tr>
      <td><div class="person-cell"><span class="person-avatar" style="background:${palette[index % palette.length]}">${escapeHtml(initials(person.name))}</span><span><span class="person-name">${escapeHtml(person.name)}</span><span class="person-role">${escapeHtml(person.role)}</span><span class="person-email">${escapeHtml(person.email)}</span></span></div></td>
      <td><span class="money">${moneyFormat.format(Number(person.salary || 0))}</span><div class="sub-money">per week</div></td>
      <td><span class="points"><span class="point-dot"></span>${numberFormat.format(Number(person.points || 0))}</span></td>
      <td><span class="money">${moneyFormat.format(balance)}</span></td>
      <td><div class="row-actions">
        <button class="pay-button" data-action="pay" data-id="${escapeHtml(person.id)}" ${isPaid ? 'disabled' : ''} title="${isPaid ? 'Salary already paid this week' : 'Add salary to wallet'}">${isPaid ? 'Paid ✓' : 'Pay salary'}</button>
        <button class="icon-button" data-action="points" data-id="${escapeHtml(person.id)}" title="Give points" aria-label="Give points to ${escapeHtml(person.name)}">✳</button>
        <button class="icon-button" data-action="money" data-id="${escapeHtml(person.id)}" title="Give money" aria-label="Give money to ${escapeHtml(person.name)}">$</button>
        <button class="icon-button" data-action="edit" data-id="${escapeHtml(person.id)}" title="Edit person" aria-label="Edit ${escapeHtml(person.name)}">✎</button>
        <button class="pay-button" data-action="invite" data-id="${escapeHtml(person.id)}" ${invitationDisabled}>${invitationLabel}</button>
      </div></td>
    </tr>`;
  }).join('');
  const empty = $('#emptyState');
  empty.hidden = visible.length > 0;
  if (!data.people.length) {
    $('#emptyTitle').textContent = 'No people yet';
    $('#emptyText').textContent = 'Add your first teammate to get started.';
  } else if (!visible.length) {
    $('#emptyTitle').textContent = 'No matching people';
    $('#emptyText').textContent = 'Try another name or role filter.';
  }
}

function renderActivity() {
  const list = $('#activityList');
  $('#activityCount').textContent = String(data.activity.length);
  if (!data.activity.length) {
    list.innerHTML = '<div class="activity-empty">Your team’s rewards and salary payments will show up here.</div>';
    return;
  }
  list.innerHTML = data.activity.slice(0, 8).map(item => {
    const cash = item.kind === 'money' || item.kind === 'salary';
    const amount = item.kind === 'points' ? `${item.amount} pts` : moneyFormat.format(Number(item.amount));
    const action = item.kind === 'points' ? 'received points' : item.kind === 'salary' ? 'received weekly salary' : 'received money';
    const time = new Date(item.at);
    const date = Number.isNaN(time.getTime()) ? '' : time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<div class="activity-item"><span class="activity-icon ${cash ? 'cash' : ''}">${item.kind === 'points' ? '✳' : '$'}</span><div class="activity-text"><strong>${escapeHtml(item.personName)}</strong> ${action}${item.note ? ` · ${escapeHtml(item.note)}` : ''}<div class="activity-meta"><span>${escapeHtml(date)}</span><span class="activity-amount ${cash ? 'cash' : ''}">${item.kind === 'points' ? '+' : ''}${escapeHtml(amount)}</span></div></div></div>`;
  }).join('');
}

function openPerson(person) {
  editingId = person?.id || null;
  const form = $('#personForm');
  form.reset();
  $('#personDialogTitle').textContent = person ? 'Edit person' : 'Add a person';
  $('#savePersonButton').textContent = person ? 'Save changes' : 'Add person';
  $('#personName').value = person?.name || '';
  $('#personRole').value = person?.role || '';
  $('#personEmail').value = person?.email || '';
  $('#personEmail').disabled = Boolean(person?.invitedAt || person?.userId);
  $('#personSalary').value = person?.salary ?? '';
  openOverlay('personOverlay');
}

function openReward(person, kind) {
  rewardPersonId = person.id;
  $('#rewardForm').reset();
  $('#rewardType').value = kind;
  $('#rewardAmount').step = kind === 'points' ? '1' : '0.01';
  $('#rewardAmount').min = kind === 'points' ? '1' : '0.01';
  $('#rewardAmount').value = '';
  $('#rewardAmountLabel').textContent = kind === 'points' ? 'Points to give' : 'Money to give';
  $('#rewardDescription').textContent = `Give ${kind === 'points' ? 'points' : 'money'} to ${person.name}.`;
  openOverlay('rewardOverlay');
}

function renderInvitee() {
  const person = data.people[0];
  $('#inviteeName').textContent = `Hello, ${person.name}`;
  $('#inviteeRole').textContent = person.role;
  $('#inviteePoints').textContent = numberFormat.format(person.points);
  $('#inviteeMoney').textContent = moneyFormat.format(person.money);
  $('#inviteeSalary').textContent = moneyFormat.format(person.salary);
  renderAppeals(false);
}

function renderAppeals(owner) {
  const list = owner ? $('#ownerAppealList') : $('#inviteeAppealList');
  const appeals = owner ? data.appeals : data.appeals;
  const count = owner ? $('#appealCount') : $('#myAppealCount');
  count.textContent = String(appeals.length);
  if (!appeals.length) {
    list.innerHTML = '<div class="activity-empty">No appeals yet.</div>';
    return;
  }
  const peopleById = new Map(data.people.map(person => [person.id, person]));
  list.innerHTML = appeals.map(appeal => {
    const person = peopleById.get(appeal.person_id);
    const personName = person?.name || 'Team member';
    const field = ({ points: 'Points', money: 'Money or wallet', role: 'Role', name: 'Name' })[appeal.field] || appeal.field;
    const created = new Date(appeal.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const comments = data.comments.filter(comment => comment.appeal_id === appeal.id);
    const commentsMarkup = comments.length
      ? comments.map(comment => {
        const author = comment.author_id === user.id ? 'You' : owner ? personName : 'Workspace owner';
        return `<div class="appeal-comment"><strong>${escapeHtml(author)}:</strong> ${escapeHtml(comment.body)}</div>`;
      }).join('')
      : '<div class="activity-empty">No comments yet.</div>';
    const statusControl = owner
      ? `<select class="status-select" data-appeal-status="${escapeHtml(appeal.id)}" aria-label="Appeal status"><option value="open" ${appeal.status === 'open' ? 'selected' : ''}>Open</option><option value="under_review" ${appeal.status === 'under_review' ? 'selected' : ''}>Under review</option><option value="resolved" ${appeal.status === 'resolved' ? 'selected' : ''}>Resolved</option></select>`
      : `<span class="appeal-status">${escapeHtml(appeal.status.replace('_', ' '))}</span>`;
    return `<article class="appeal-card">
      <div class="appeal-top"><div><div class="appeal-title">${escapeHtml(field)} appeal${owner ? ` · ${escapeHtml(personName)}` : ''}</div><div class="appeal-meta">${escapeHtml(created)}${appeal.requested_value ? ` · Requested: ${escapeHtml(appeal.requested_value)}` : ''}</div></div>${statusControl}</div>
      <p class="appeal-body">${escapeHtml(appeal.message)}</p>
      <div class="appeal-comments">${commentsMarkup}<form class="comment-form" data-appeal-id="${escapeHtml(appeal.id)}"><input name="body" required maxlength="2000" aria-label="Add a comment" placeholder="Write a comment…"><button class="button button-primary" type="submit">Comment</button></form></div>
    </article>`;
  }).join('');
}

async function refreshDashboard() {
  if (userRole === 'owner') {
    await loadOwnerData();
    renderOwner();
  } else {
    await loadInviteeData();
    renderInvitee();
  }
}

$('#authForm').addEventListener('submit', event => {
  event.preventDefault();
  runSafely(async () => {
    $('#authError').hidden = true;
    const email = $('#authEmail').value.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({
  email,
  password: '09120912',
});
    if (error) throw error;
    $('#authNote').textContent = 'Signing in...';
});

$('#ownerSignOut').addEventListener('click', () => runSafely(() => supabase.auth.signOut()));
$('#inviteeSignOut').addEventListener('click', () => runSafely(() => supabase.auth.signOut()));

$('#addPerson').addEventListener('click', () => openPerson(null));
$('#personForm').addEventListener('submit', event => {
  event.preventDefault();
  runSafely(async () => {
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name')).trim();
    const role = String(form.get('role')).trim();
    const email = $('#personEmail').value.trim().toLowerCase();
    const salary = Number(form.get('salary'));
    if (!name || !role || !email || !Number.isFinite(salary) || salary < 0) throw new Error('Check the name, email, role, and salary.');
    if (editingId) {
      const person = data.people.find(item => item.id === editingId);
      if (!person) throw new Error('This team member could not be found.');
      person.name = name;
      person.role = role;
      person.email = email;
      person.salary = salary;
    } else {
      data.people.push({ id: crypto.randomUUID(), name, email, role, salary, points: 0, money: 0, paidWeek: null });
    }
    await saveOwnerData();
    closeOverlay('personOverlay');
    renderOwner();
    setToast(editingId ? 'Person updated.' : `${name} added to your team.`);
  });
});

$('#rewardType').addEventListener('change', event => {
  const type = event.target.value;
  $('#rewardAmount').step = type === 'points' ? '1' : '0.01';
  $('#rewardAmount').min = type === 'points' ? '1' : '0.01';
  $('#rewardAmountLabel').textContent = type === 'points' ? 'Points to give' : 'Money to give';
});

$('#rewardForm').addEventListener('submit', event => {
  event.preventDefault();
  runSafely(async () => {
    const person = data.people.find(item => item.id === rewardPersonId);
    if (!person) throw new Error('This team member could not be found.');
    const type = $('#rewardType').value;
    const amount = Number($('#rewardAmount').value);
    const note = $('#rewardNote').value.trim();
    if (!Number.isFinite(amount) || amount <= 0 || (type === 'points' && !Number.isInteger(amount))) {
      throw new Error(type === 'points' ? 'Enter a whole number of points.' : 'Enter a valid amount.');
    }
    if (type === 'points') person.points = Number(person.points || 0) + amount;
    else person.money = Math.round((Number(person.money || 0) + amount) * 100) / 100;
    addActivity({ personId: person.id, kind: type, amount, personName: person.name, note });
    await saveOwnerData();
    closeOverlay('rewardOverlay');
    renderOwner();
    setToast(type === 'points' ? `${numberFormat.format(amount)} points given to ${person.name}.` : `${moneyFormat.format(amount)} given to ${person.name}.`);
  });
});

$('#rosterBody').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const person = data.people.find(item => item.id === button.dataset.id);
  if (!person) return;
  if (button.dataset.action === 'points' || button.dataset.action === 'money') {
    openReward(person, button.dataset.action);
    return;
  }
  if (button.dataset.action === 'edit') {
    openPerson(person);
    return;
  }
  if (button.dataset.action === 'invite') {
    runSafely(async () => {
      const { data: result, error } = await supabase.functions.invoke('invite-person', { body: { personId: person.id } });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      await loadOwnerData();
      renderOwner();
      setToast(`Invitation sent to ${person.email}.`);
    });
    return;
  }
  if (button.dataset.action === 'pay') {
    runSafely(async () => {
      if (person.paidWeek === getWeekKey()) return;
      person.money = Math.round((Number(person.money || 0) + Number(person.salary || 0)) * 100) / 100;
      person.paidWeek = getWeekKey();
      addActivity({ personId: person.id, kind: 'salary', amount: Number(person.salary || 0), personName: person.name, note: 'Weekly salary' });
      await saveOwnerData();
      renderOwner();
      setToast(`Weekly salary paid to ${person.name}.`);
    });
  }
});

$('#searchInput').addEventListener('input', renderRoster);
$('#roleFilter').addEventListener('change', renderRoster);

$('#appealForm').addEventListener('submit', event => {
  event.preventDefault();
  runSafely(async () => {
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from('appeals').insert({
      person_id: data.people[0].id,
      requester_id: user.id,
      field: String(form.get('field')),
      requested_value: String(form.get('requestedValue')).trim(),
      message: String(form.get('message')).trim()
    });
    if (error) throw error;
    event.currentTarget.reset();
    await refreshDashboard();
    setToast('Your appeal was sent to the workspace owner.');
  });
});

document.addEventListener('submit', event => {
  const form = event.target.closest('form.comment-form');
  if (!form) return;
  event.preventDefault();
  runSafely(async () => {
    const body = new FormData(form).get('body').toString().trim();
    const { error } = await supabase.from('appeal_comments').insert({
      appeal_id: form.dataset.appealId,
      author_id: user.id,
      body
    });
    if (error) throw error;
    await refreshDashboard();
    setToast('Comment added.');
  });
});

document.addEventListener('change', event => {
  const appealId = event.target.dataset.appealStatus;
  if (!appealId) return;
  runSafely(async () => {
    const { error } = await supabase.from('appeals').update({ status: event.target.value }).eq('id', appealId);
    if (error) throw error;
    await refreshDashboard();
  });
});

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeOverlay(button.dataset.close)));
document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => {
  if (event.target === overlay) closeOverlay(overlay.id);
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(overlay => closeOverlay(overlay.id));
});

if (!configured) {
  setScreen('setupScreen');
} else {
  let loadingUserId = null;
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      const nextUser = session?.user || null;
      if (nextUser?.id === loadingUserId) return;
      loadingUserId = nextUser?.id || null;
      if (!nextUser) {
        user = null;
        userRole = null;
        data = { people: [], activity: [], appeals: [], comments: [] };
        setScreen('authScreen');
        return;
      }
      runSafely(() => loadDashboard(nextUser));
    }, 0);
  });
  supabase.auth.getSession().then(({ data: sessionData, error }) => {
    if (error) throw error;
    if (sessionData.session?.user) {
      if (loadingUserId === sessionData.session.user.id) return;
      loadingUserId = sessionData.session.user.id;
      return loadDashboard(sessionData.session.user);
    }
    setScreen('authScreen');
  }).catch(reportError);
}
