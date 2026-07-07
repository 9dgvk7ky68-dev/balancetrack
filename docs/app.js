const STORAGE_KEY = 'balancetrack-state-v2';
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
  },
  timesheetDays: [],
};

const state = loadState();
const tabButtons = document.querySelectorAll('.tab-btn');
const views = document.querySelectorAll('.view');
const ttbBalanceEl = document.getElementById('ttbBalance');
const dayBalanceEl = document.getElementById('dayBalance');
const fortnightSummaryEl = document.getElementById('fortnightSummary');
const fortnightOtEl = document.getElementById('fortnightOt');
const latestEntryEl = document.getElementById('latestEntry');
const entryList = document.getElementById('entryList');
const emptyState = document.getElementById('emptyState');
const timesheetDaysEl = document.getElementById('timesheetDays');
const clearButton = document.getElementById('clearButton');
const resetTimesheetBtn = document.getElementById('resetTimesheetBtn');
const addTtbBtn = document.getElementById('addTtbBtn');
const useTtbBtn = document.getElementById('useTtbBtn');
const addDayBtn = document.getElementById('addDayBtn');
const useDayBtn = document.getElementById('useDayBtn');
const profileForm = document.getElementById('profileForm');
const settingsForm = document.getElementById('settingsForm');

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
    };
  } catch (error) {
    console.warn('Could not load state', error);
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getMondayOfCurrentWeek(reference = new Date()) {
  const date = new Date(reference);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildFortnightDays() {
  const start = getMondayOfCurrentWeek();
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    return {
      date: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      isWeekend,
      start: isWeekend ? '' : '08:00',
      finish: isWeekend ? '' : '16:30',
      workedHours: isWeekend ? 0 : 8,
      overtime: 0,
    };
  });
}

function ensureTimesheetDays() {
  if (!state.timesheetDays || state.timesheetDays.length !== 14) {
    state.timesheetDays = buildFortnightDays();
    saveState();
  }
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
  const value = Number(String(rawValue).trim());
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
  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

  ttbBalanceEl.textContent = formatTtbAmount(balances.ttb);
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
  document.getElementById('startingTtb').value = state.settings.startingTtb;
  document.getElementById('startingDay').value = state.settings.startingDay;
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
  addEntry('ttb', action, parsedValue, action === 'earned' ? 'Quick TTB add' : 'Quick TTB use');
}

addTtbBtn.addEventListener('click', () => addTtbQuickEntry('earned'));
useTtbBtn.addEventListener('click', () => addTtbQuickEntry('used'));
addDayBtn.addEventListener('click', () => addEntry('day', 'earned', 1, 'Quick day add'));
useDayBtn.addEventListener('click', () => addEntry('day', 'used', 1, 'Quick day use'));

clearButton.addEventListener('click', () => {
  if (!state.entries.length) return;
  if (window.confirm('Clear all entries?')) {
    state.entries = [];
    saveState();
    render();
  }
});

resetTimesheetBtn.addEventListener('click', () => {
  state.timesheetDays = buildFortnightDays();
  saveState();
  render();
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
  if (name === 'startingTtb') {
    const parsed = parseQuarterHourValue(value);
    state.settings[name] = parsed ?? 0;
  } else {
    state.settings[name] = Number(value) || 0;
  }
  saveState();
  render();
});

timesheetDaysEl.addEventListener('change', (event) => {
  const row = event.target.closest('.timesheet-row');
  if (!row) return;
  const index = Number(row.dataset.index);
  const field = event.target.dataset.field;
  state.timesheetDays[index][field] = event.target.value;
  saveState();
  render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  });
}

render();
switchTab('dashboard');
