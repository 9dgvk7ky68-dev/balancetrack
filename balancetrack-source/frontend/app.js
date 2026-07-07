const STORAGE_KEY = 'balancetrack-state-v2';
const SUPABASE_TABLE = 'balancetrack_states';
const SUPABASE_URL = 'https://aumqpoaupqcbrkxozwmm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9gEri05WN-VA1hSVDXFvwQ_i_qQs6wL';
const defaultState = {
  entries: [],
  profile: {
    staffName: '',
    managerName: '',
    role: '',
    department: '',
  },
  settings: {
    startingTtb: 0,
    startingDay: 0,
    defaultStartTime: '08:00',
    defaultFinishTime: '16:30',
  },
  timesheetDays: [],
  currentFortnightKey: '',
  fortnightData: {},
};

const state = loadState();
state.currentFortnightKey = getFortnightKey(getMondayOfCurrentWeek());
state.fortnightData = state.fortnightData || {};
const tabButtons = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');
const ttbBalanceEl = document.getElementById('ttbBalance');
const ttbBalanceDaysEl = document.getElementById('ttbBalanceDays');
const dayBalanceEl = document.getElementById('dayBalance');
const fortnightSummaryEl = document.getElementById('fortnightSummary');
const fortnightOtEl = document.getElementById('fortnightOt');
const latestEntryEl = document.getElementById('latestEntry');
const entryList = document.getElementById('entryList');
const emptyState = document.getElementById('emptyState');
const timesheetDaysEl = document.getElementById('timesheetDays');
const timesheetTitleEl = document.getElementById('timesheetTitle');
const prevFortnightBtn = document.getElementById('prevFortnightBtn');
const nextFortnightBtn = document.getElementById('nextFortnightBtn');
const resetSelectedFortnightBtn = document.getElementById('resetSelectedFortnightBtn');
const resetFortnightDateEl = document.getElementById('resetFortnightDate');
const exportTtbBtn = document.getElementById('exportTtbBtn');
const authEmailEl = document.getElementById('authEmail');
const authPasswordEl = document.getElementById('authPassword');
const authSignUpBtn = document.getElementById('authSignUpBtn');
const authSignInBtn = document.getElementById('authSignInBtn');
const authSignOutBtn = document.getElementById('authSignOutBtn');
const authStatusEl = document.getElementById('authStatus');
const addTtbBtn = document.getElementById('addTtbBtn');
const useTtbBtn = document.getElementById('useTtbBtn');
const addDayBtn = document.getElementById('addDayBtn');
const useDayBtn = document.getElementById('useDayBtn');
const profileForm = document.getElementById('profileForm');
const settingsForm = document.getElementById('settingsForm');

let supabaseClient = null;
let authListenerAttached = false;
let currentUserId = null;
let syncTimer = null;
let isApplyingRemoteState = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return structuredClone(defaultState);
    }
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      profile: { ...defaultState.profile, ...(parsed.profile || {}) },
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      timesheetDays: Array.isArray(parsed.timesheetDays) ? parsed.timesheetDays : [],
      currentFortnightKey: typeof parsed.currentFortnightKey === 'string' ? parsed.currentFortnightKey : '',
      fortnightData: parsed.fortnightData && typeof parsed.fortnightData === 'object' ? parsed.fortnightData : {},
    };
  } catch (error) {
    console.warn('Could not load state', error);
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueCloudSync();
}

function getSyncableState() {
  return {
    entries: state.entries,
    profile: state.profile,
    settings: state.settings,
    timesheetDays: state.timesheetDays,
    currentFortnightKey: state.currentFortnightKey,
    fortnightData: state.fortnightData,
  };
}

function applyRemoteState(appState) {
  if (!appState || typeof appState !== 'object') return;
  state.entries = Array.isArray(appState.entries) ? appState.entries : [];
  state.profile = { ...defaultState.profile, ...(appState.profile || {}) };
  state.settings = { ...defaultState.settings, ...(appState.settings || {}) };
  state.timesheetDays = Array.isArray(appState.timesheetDays) ? appState.timesheetDays : [];
  state.currentFortnightKey = typeof appState.currentFortnightKey === 'string'
    ? appState.currentFortnightKey
    : getFortnightKey(getMondayOfCurrentWeek());
  state.fortnightData = appState.fortnightData && typeof appState.fortnightData === 'object'
    ? appState.fortnightData
    : {};
}

async function connectSupabase() {
  if (!window.supabase?.createClient) {
    setAuthStatus('Supabase library failed to load. Refresh and try again.', true);
    return null;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  if (!authListenerAttached) {
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      currentUserId = session?.user?.id || null;
      if (currentUserId) {
        authEmailEl.value = session.user.email || authEmailEl.value;
        setAuthStatus(`Connected as ${session.user.email}. Syncing...`);
        await pullStateFromCloud();
      } else {
        setAuthStatus('Signed out. Data is local until you sign in again.');
      }
    });
    authListenerAttached = true;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthStatus(`Could not verify session: ${error.message}`, true);
    return null;
  }

  currentUserId = data.session?.user?.id || null;
  if (currentUserId) {
    setAuthStatus(`Connected as ${data.session.user.email}. Syncing...`);
    await pullStateFromCloud();
  } else {
    setAuthStatus('Register or sign in with your email to sync between devices.');
  }

  return supabaseClient;
}

async function pullStateFromCloud() {
  if (!supabaseClient || !currentUserId) return;

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .select('app_state')
    .eq('user_id', currentUserId)
    .maybeSingle();

  if (error) {
    setAuthStatus(`Cloud read failed: ${error.message}`, true);
    return;
  }

  if (data?.app_state) {
    isApplyingRemoteState = true;
    applyRemoteState(data.app_state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    isApplyingRemoteState = false;
    render();
    setAuthStatus('Cloud data synced to this device.');
  } else {
    await pushStateToCloud();
    setAuthStatus('No cloud data found. Uploaded local data as baseline.');
  }
}

async function pushStateToCloud() {
  if (!supabaseClient || !currentUserId || isApplyingRemoteState) return;

  const payload = {
    user_id: currentUserId,
    app_state: getSyncableState(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    setAuthStatus(`Cloud sync failed: ${error.message}`, true);
    return;
  }

  setAuthStatus('Synced across signed-in devices.');
}

function queueCloudSync() {
  if (!supabaseClient || !currentUserId || isApplyingRemoteState) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    pushStateToCloud().catch((error) => {
      setAuthStatus(`Cloud sync failed: ${error.message}`, true);
    });
  }, 500);
}

function getMondayOfCurrentWeek(reference = new Date()) {
  const date = new Date(reference);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateString) {
  if (typeof dateString !== 'string' || dateString.length !== 10) {
    return new Date();
  }
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLongDate(dateString) {
  const normalizedDate = typeof dateString === 'string' && dateString.length === 10
    ? `${dateString}T12:00:00`
    : dateString;
  const date = new Date(normalizedDate);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const rest = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${weekday} ${rest}`;
}

function getFortnightKey(referenceDate = new Date()) {
  return formatLocalDate(getMondayOfCurrentWeek(referenceDate));
}

function buildFortnightDays(anchorDate = getMondayOfCurrentWeek()) {
  const start = new Date(anchorDate);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    return {
      date: formatLocalDate(date),
      label: formatLongDate(formatLocalDate(date)),
      isWeekend,
      start: isWeekend ? '' : state.settings.defaultStartTime || '08:00',
      finish: isWeekend ? '' : state.settings.defaultFinishTime || '16:30',
      workedHours: isWeekend ? 0 : 8,
      overtime: 0,
    };
  });
}

function saveCurrentFortnight() {
  if (!state.currentFortnightKey) return;
  state.fortnightData[state.currentFortnightKey] = (state.timesheetDays || []).map((day) => ({ ...day }));
  saveState();
}

function ensureTimesheetDays() {
  if (!state.currentFortnightKey) {
    state.currentFortnightKey = getFortnightKey(getMondayOfCurrentWeek());
  }

  const storedFortnight = state.fortnightData[state.currentFortnightKey];
  if (Array.isArray(storedFortnight) && storedFortnight.length === 14) {
    state.timesheetDays = storedFortnight.map((day) => ({ ...day }));
    return;
  }

  state.timesheetDays = buildFortnightDays(getMondayOfCurrentWeek(state.currentFortnightKey));
  saveCurrentFortnight();
}

function getFortnightStartFromDate(selectedDate) {
  const referenceStart = getMondayOfCurrentWeek();
  const selected = parseLocalDate(selectedDate);
  selected.setHours(0, 0, 0, 0);
  const diffDays = Math.round((selected - referenceStart) / 86400000);
  const offset = Math.floor(diffDays / 14);
  const start = new Date(referenceStart);
  start.setDate(referenceStart.getDate() + offset * 14);
  return start;
}

function setCurrentFortnight(anchorDate) {
  const monday = new Date(anchorDate);
  monday.setHours(0, 0, 0, 0);
  state.currentFortnightKey = getFortnightKey(monday);
  const storedFortnight = state.fortnightData[state.currentFortnightKey];
  state.timesheetDays = Array.isArray(storedFortnight) && storedFortnight.length === 14
    ? storedFortnight.map((day) => ({ ...day }))
    : buildFortnightDays(monday);
  saveCurrentFortnight();
}

function toMinutes(time) {
  if (!time) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function calculateDayHours(day) {
  if (!day.start || !day.finish) {
    return { workedHours: 0, overtime: 0 };
  }

  const startMinutes = toMinutes(day.start);
  const finishMinutes = toMinutes(day.finish);
  const duration = (finishMinutes - startMinutes) / 60;

  if (day.isWeekend) {
    return {
      workedHours: Math.max(0, duration),
      overtime: Math.max(0, duration),
    };
  }

  const workedHours = Math.max(0, duration - 0.5);
  return {
    workedHours,
    overtime: Math.max(0, workedHours - 8),
  };
}

function recalculateTimesheet() {
  let totalWorked = 0;
  let totalOT = 0;

  state.timesheetDays.forEach((day) => {
    const values = calculateDayHours(day);
    day.workedHours = values.workedHours;
    day.overtime = values.overtime;
    totalWorked += values.workedHours;
    totalOT += values.overtime;
  });

  return { totalWorked, totalOT };
}

function calculateBalances() {
  const manualNet = state.entries.reduce(
    (totals, entry) => {
      const delta = entry.action === 'used' ? -entry.amount : entry.amount;
      totals[entry.type === 'day' ? 'day' : 'ttb'] += delta;
      return totals;
    },
    { ttb: Number(state.settings.startingTtb || 0), day: Number(state.settings.startingDay || 0) }
  );

  const { totalOT } = recalculateTimesheet();
  manualNet.ttb += totalOT;
  return manualNet;
}

function parseQuarterHourValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;

  const textValue = String(rawValue).trim();
  if (!textValue) return null;

  const normalizedValue = textValue.replace(/\s+/g, '').replace(/h$/, '').replace(/hr$/, '').replace(/hrs$/, '');
  const value = Number(normalizedValue);
  if (!Number.isFinite(value) || value <= 0) return null;

  const scaled = Math.round(value * 4);
  if (scaled <= 0 || Math.abs(value * 4 - scaled) > 1e-9) return null;
  return scaled / 4;
}

function formatTtbAmount(hours) {
  const totalMinutes = Math.round(Number(hours || 0) * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours && minutes) return `${wholeHours}h ${minutes}m`;
  if (wholeHours) return `${wholeHours}h`;
  if (minutes) return `${minutes}m`;
  return '0m';
}

function formatAmount(type, amount, action) {
  const sign = action === 'used' ? '-' : '+';
  if (type === 'day') return `${sign}${Number(amount).toFixed(2)}d`;
  return `${sign}${formatTtbAmount(amount)}`;
}

function formatDate(dateString) {
  const normalizedDate = typeof dateString === 'string' && dateString.length === 10
    ? `${dateString}T12:00:00`
    : dateString;
  return new Date(normalizedDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toTimeString(totalMinutes) {
  const bounded = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(bounded / 60);
  const minutes = bounded % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function applyExtraTimeToDay(day, hoursToAdd) {
  const minutesToAdd = Math.round(hoursToAdd * 60);

  if (!day.start) {
    day.start = state.settings.defaultStartTime || '08:00';
  }

  const startMinutes = toMinutes(day.start);
  if (!day.finish) {
    const baseHours = day.isWeekend ? 0 : 8.5;
    day.finish = toTimeString(startMinutes + Math.round((baseHours + hoursToAdd) * 60));
    return;
  }

  const finishMinutes = toMinutes(day.finish);
  day.finish = toTimeString(finishMinutes + minutesToAdd);
}

function applyExtraTimeToDate(dateString, hoursToAdd) {
  const currentDay = state.timesheetDays.find((day) => day.date === dateString);
  if (currentDay) {
    applyExtraTimeToDay(currentDay, hoursToAdd);
    saveCurrentFortnight();
    return true;
  }

  for (const [key, days] of Object.entries(state.fortnightData)) {
    if (!Array.isArray(days)) continue;
    const targetDay = days.find((day) => day.date === dateString);
    if (!targetDay) continue;

    applyExtraTimeToDay(targetDay, hoursToAdd);
    state.fortnightData[key] = days;
    saveState();
    return true;
  }

  const startDate = getFortnightStartFromDate(dateString);
  const key = getFortnightKey(startDate);
  const createdDays = buildFortnightDays(startDate);
  const createdDay = createdDays.find((day) => day.date === dateString);
  if (!createdDay) return false;

  applyExtraTimeToDay(createdDay, hoursToAdd);
  state.fortnightData[key] = createdDays;
  saveState();
  return true;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsvFile(fileName, rows) {
  const content = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportTtbCsv() {
  const earnedTtbEntries = state.entries
    .filter((entry) => entry.type === 'ttb' && entry.action === 'earned')
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!earnedTtbEntries.length) {
    window.alert('No earned TTB entries available to export yet.');
    return;
  }

  const rows = [['Date', 'TTB added (minutes)', 'Reason']];
  let totalMinutes = 0;

  earnedTtbEntries.forEach((entry) => {
    const minutes = Math.round(Number(entry.amount || 0) * 60);
    totalMinutes += minutes;
    rows.push([
      formatDate(entry.date),
      String(minutes),
      entry.note || 'No reason entered',
    ]);
  });

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  rows.push(['', '', '']);
  rows.push(['TOTAL', `${totalHours}h ${remainingMinutes}m`, '']);

  const exportDate = formatLocalDate(new Date());
  downloadCsvFile(`ttb-export-${exportDate}.csv`, rows);
}

function setAuthStatus(message, isError = false) {
  if (!authStatusEl) return;
  authStatusEl.textContent = message;
  authStatusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function validateAuthInputs() {
  const email = String(authEmailEl?.value || '').trim();
  const password = String(authPasswordEl?.value || '');

  if (!email || !/.+@.+\..+/.test(email)) {
    setAuthStatus('Enter a valid email address.', true);
    return null;
  }

  if (password.length < 8) {
    setAuthStatus('Password must be at least 8 characters.', true);
    return null;
  }

  return { email, password };
}

function addEntry(type, action, amount, note) {
  state.entries.unshift({
    id: crypto.randomUUID(),
    type,
    action,
    amount,
    note,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
  });
  saveState();
  render();
}

function renderDashboard() {
  const balances = calculateBalances();
  const latest = state.entries[0];

  const ttbHours = Number(balances.ttb || 0);
  const ttbDays = ttbHours / 8;
  const totalMinutes = Math.round(ttbHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  ttbBalanceEl.textContent = `${hours}h ${minutes}m`;
  ttbBalanceDaysEl.textContent = `${ttbDays.toFixed(2)} days`;
  dayBalanceEl.textContent = `${balances.day.toFixed(1)}d`;

  const { totalWorked, totalOT } = recalculateTimesheet();
  fortnightSummaryEl.textContent = `${totalWorked.toFixed(1)}h worked`;
  fortnightOtEl.textContent = `${totalOT.toFixed(1)}h OT accrued`;

  latestEntryEl.textContent = latest ? `${latest.type === 'ttb' ? 'TTB' : 'Days in lieu'} · ${formatDate(latest.date)}` : 'No entries yet';
}

function renderEntries() {
  if (!state.entries.length) {
    emptyState.hidden = false;
    entryList.innerHTML = '';
    return;
  }

  emptyState.hidden = true;
  entryList.innerHTML = state.entries
    .slice(0, 8)
    .map((entry) => {
      const label = entry.type === 'ttb' ? 'TTB' : 'Days in lieu';
      return `
        <li class="entry-item">
          <div>
            <strong>${label}</strong>
            <div class="entry-meta">${entry.note || 'No note'} · ${formatDate(entry.date)}</div>
          </div>
          <div>
            <span class="entry-pill ${entry.action}">${formatAmount(entry.type, entry.amount, entry.action)}</span>
          </div>
        </li>
      `;
    })
    .join('');
}

function renderTimesheet() {
  const startDate = state.timesheetDays[0]?.date;
  const endDate = state.timesheetDays[state.timesheetDays.length - 1]?.date;
  const rangeLabel = startDate && endDate
    ? `${formatLongDate(startDate)} – ${formatLongDate(endDate)}`
    : 'Work hours';
  timesheetTitleEl.textContent = rangeLabel;

  timesheetDaysEl.innerHTML = state.timesheetDays
    .map((day, index) => {
      const daySummary = calculateDayHours(day);
      return `
        <div class="timesheet-row" data-index="${index}">
          <div class="date-cell">
            <strong>${day.label}</strong>
            <span>${day.isWeekend ? 'Weekend' : 'Weekday'}</span>
          </div>
          <label class="time-input">
            <span>Start</span>
            <input type="time" data-field="start" value="${day.start || ''}" ${day.isWeekend ? 'disabled' : ''} />
          </label>
          <label class="time-input">
            <span>Finish</span>
            <input type="time" data-field="finish" value="${day.finish || ''}" ${day.isWeekend ? 'disabled' : ''} />
          </label>
          <div class="hours-pill">${daySummary.workedHours.toFixed(1)}h</div>
          <div class="ot-pill">${daySummary.overtime.toFixed(1)}h OT</div>
        </div>
      `;
    })
    .join('');
}

function renderProfile() {
  document.getElementById('staffName').value = state.profile.staffName;
  document.getElementById('managerName').value = state.profile.managerName;
  document.getElementById('role').value = state.profile.role;
  document.getElementById('department').value = state.profile.department;
  document.getElementById('startingTtb').value = state.settings.startingTtb.toFixed(2).replace(/\.00$/, '');
  document.getElementById('startingDay').value = state.settings.startingDay;
  document.getElementById('defaultStartTime').value = state.settings.defaultStartTime || '08:00';
  document.getElementById('defaultFinishTime').value = state.settings.defaultFinishTime || '16:30';
}

function render() {
  ensureTimesheetDays();
  renderDashboard();
  renderEntries();
  renderTimesheet();
  renderProfile();
}

function switchTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });
  views.forEach((view) => {
    view.classList.toggle('active', view.id === `${tabName}View`);
  });
}

function addTtbQuickEntry(action) {
  const rawValue = window.prompt('Enter TTB amount in quarter-hour steps (0.25, 0.5, 0.75, 1, etc.)', '0.25');
  if (rawValue === null) return;
  const parsedValue = parseQuarterHourValue(rawValue);
  if (!parsedValue) {
    window.alert('Please enter a positive value in quarter-hour increments such as 0.25, 0.5, 0.75, or 1.');
    return;
  }

  let note = action === 'earned' ? 'Quick TTB add' : 'Quick TTB use';
  if (action === 'earned') {
    const reasonPrompt = window.prompt(
      'Select reason for adding TTB:\n1. No lunch taken\n2. Additional travel due to traffic/accident\n3. Extra time worked',
      '1'
    );

    if (reasonPrompt === null) return;

    const reasonMap = {
      1: 'No lunch taken',
      2: 'Additional travel due to traffic/accident',
      3: 'Extra time worked',
    };

    const selectedReason = reasonMap[Number(String(reasonPrompt).trim())];
    if (!selectedReason) {
      window.alert('Please choose 1, 2, or 3 for the TTB reason.');
      return;
    }

    if (selectedReason === 'Extra time worked') {
      const defaultDate = formatLocalDate(new Date());
      const chosenDate = window.prompt('Enter date for this extra time (YYYY-MM-DD)', defaultDate);
      if (chosenDate === null) return;

      const normalizedDate = String(chosenDate).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        window.alert('Please enter the date in YYYY-MM-DD format.');
        return;
      }

      const parsedDate = parseLocalDate(normalizedDate);
      if (formatLocalDate(parsedDate) !== normalizedDate) {
        window.alert('Please enter a valid date in YYYY-MM-DD format.');
        return;
      }

      const applied = applyExtraTimeToDate(normalizedDate, parsedValue);
      if (!applied) {
        window.alert('Could not apply extra time to that date. Please try again.');
        return;
      }

      note = `${selectedReason} (${normalizedDate})`;
    } else {
      note = selectedReason;
    }
  }

  addEntry('ttb', action, parsedValue, note);
}

addTtbBtn.addEventListener('click', () => addTtbQuickEntry('earned'));
useTtbBtn.addEventListener('click', () => addTtbQuickEntry('used'));
addDayBtn.addEventListener('click', () => addEntry('day', 'earned', 1, 'Quick day add'));
useDayBtn.addEventListener('click', () => addEntry('day', 'used', 1, 'Quick day use'));

prevFortnightBtn.addEventListener('click', () => {
  const anchor = parseLocalDate(state.currentFortnightKey || getFortnightKey(getMondayOfCurrentWeek()));
  anchor.setDate(anchor.getDate() - 14);
  setCurrentFortnight(anchor);
  render();
});

nextFortnightBtn.addEventListener('click', () => {
  const anchor = parseLocalDate(state.currentFortnightKey || getFortnightKey(getMondayOfCurrentWeek()));
  anchor.setDate(anchor.getDate() + 14);
  setCurrentFortnight(anchor);
  render();
});

resetSelectedFortnightBtn.addEventListener('click', () => {
  const selectedDate = resetFortnightDateEl.value;
  if (!selectedDate) {
    window.alert('Please select a date in the fortnight you want to reset.');
    return;
  }

  const startDate = getFortnightStartFromDate(selectedDate);
  const resetAnchor = new Date(startDate);
  const resetDays = buildFortnightDays(resetAnchor).map((day) => ({
    ...day,
    start: day.isWeekend ? '' : state.settings.defaultStartTime || '08:00',
    finish: day.isWeekend ? '' : state.settings.defaultFinishTime || '16:30',
    workedHours: day.isWeekend ? 0 : 8,
    overtime: 0,
  }));

  state.currentFortnightKey = getFortnightKey(resetAnchor);
  state.timesheetDays = resetDays;
  state.fortnightData[state.currentFortnightKey] = resetDays;
  saveState();
  render();
});

exportTtbBtn.addEventListener('click', () => {
  exportTtbCsv();
});

authSignUpBtn.addEventListener('click', () => {
  const values = validateAuthInputs();
  if (!values) return;

  (async () => {
    const client = await connectSupabase();
    if (!client) return;

    const { error } = await client.auth.signUp({
      email: values.email,
      password: values.password,
    });

    if (error) {
      setAuthStatus(`Registration failed: ${error.message}`, true);
      return;
    }

    setAuthStatus('Registration submitted. Check email for confirmation if required.');
  })();
});

authSignInBtn.addEventListener('click', () => {
  const values = validateAuthInputs();
  if (!values) return;

  (async () => {
    const client = await connectSupabase();
    if (!client) return;

    const { data, error } = await client.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    if (error) {
      setAuthStatus(`Sign in failed: ${error.message}`, true);
      return;
    }

    currentUserId = data.user?.id || null;
    await pullStateFromCloud();
  })();
});

authSignOutBtn.addEventListener('click', () => {
  (async () => {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    currentUserId = null;
    if (authEmailEl) authEmailEl.value = '';
    if (authPasswordEl) authPasswordEl.value = '';
    setAuthStatus('Signed out. CSV export remains available as backup.');
  })();
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

profileForm.addEventListener('input', (event) => {
  const { name, value } = event.target;
  state.profile[name] = value;
  saveState();
});

settingsForm.addEventListener('input', (event) => {
  const { name, value } = event.target;
  if (name === 'startingTtb' || name === 'startingDay') {
    const parsed = parseQuarterHourValue(value);
    state.settings[name] = parsed ?? 0;
  } else if (name === 'defaultStartTime' || name === 'defaultFinishTime') {
    state.settings[name] = value;
  } else {
    state.settings[name] = Number(value) || 0;
  }
  saveState();

  if (name === 'defaultStartTime' || name === 'defaultFinishTime') {
    state.timesheetDays = state.timesheetDays.map((day) => {
      if (day.isWeekend) return day;
      const currentStart = day.start || state.settings.defaultStartTime || '08:00';
      const currentFinish = day.finish || state.settings.defaultFinishTime || '16:30';
      const hasBeenEdited = Boolean(day.start && day.finish && (currentStart !== state.settings.defaultStartTime || currentFinish !== state.settings.defaultFinishTime));
      if (hasBeenEdited) return day;
      return {
        ...day,
        start: state.settings.defaultStartTime || '08:00',
        finish: state.settings.defaultFinishTime || '16:30',
      };
    });
    saveState();
  }

  render();
});

timesheetDaysEl.addEventListener('change', (event) => {
  const row = event.target.closest('.timesheet-row');
  if (!row) return;

  const index = Number(row.dataset.index);
  const field = event.target.dataset.field;
  const day = state.timesheetDays[index];
  if (!day) return;

  day[field] = event.target.value;
  saveCurrentFortnight();

  const daySummary = calculateDayHours(day);
  const hoursPill = row.querySelector('.hours-pill');
  const otPill = row.querySelector('.ot-pill');
  if (hoursPill) {
    hoursPill.textContent = `${daySummary.workedHours.toFixed(1)}h`;
  }
  if (otPill) {
    otPill.textContent = `${daySummary.overtime.toFixed(1)}h OT`;
  }

  renderDashboard();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}

render();
switchTab('dashboard');

connectSupabase().catch((error) => {
  setAuthStatus(`Connect failed: ${error.message}`, true);
});
