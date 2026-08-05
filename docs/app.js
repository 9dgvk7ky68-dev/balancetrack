const STORAGE_KEY = 'balancetrack-state-v2';
const SUPABASE_TABLE = 'balancetrack_states';
const SUPABASE_URL = 'https://aumqpoaupqcbrkxozwmm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_9gEri05WN-VA1hSVDXFvwQ_i_qQs6wL';
const defaultState = {
  entries: [],
  profile: {
    staffName: '',
    managerName: '',
    managerEmail: '',
    location: '',
    role: '',
  },
  settings: {
    startingTtb: 0,
    startingDay: 0,
    defaultStartTime: '08:00',
    defaultFinishTime: '16:30',
    timeFormat: '12h',
    colorScheme: 'fern',
    customColor: '#5f8f68',
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
const managerEmailEl = document.getElementById('managerEmail');
const locationEl = document.getElementById('location');
const colorSchemeEl = document.getElementById('colorScheme');
const customColorInputEl = document.getElementById('customColor');
const themeSwatchesEl = document.getElementById('themeSwatches');
const bugReportCategoryEl = document.getElementById('bugReportCategory');
const bugReportSeverityEl = document.getElementById('bugReportSeverity');
const bugReportDetailsEl = document.getElementById('bugReportDetails');
const bugReportCountEl = document.getElementById('bugReportCount');
const copyBugReportBtn = document.getElementById('copyBugReportBtn');
const sendBugReportBtn = document.getElementById('sendBugReportBtn');
const bugReportStatusEl = document.getElementById('bugReportStatus');
const choiceDialogEl = document.getElementById('choiceDialog');
const choiceDialogTitleEl = document.getElementById('choiceDialogTitle');
const choiceDialogMessageEl = document.getElementById('choiceDialogMessage');
const choiceDialogActionsEl = document.getElementById('choiceDialogActions');
const rememberSignInEl = document.getElementById('rememberSignIn');

const SUPPORT_EMAIL = 'david.andrews@seatingtogo.co.nz';
const BUG_REPORT_ENDPOINT = `https://formsubmit.co/ajax/${encodeURIComponent(SUPPORT_EMAIL)}`;
const BUG_REPORT_DRAFT_KEY = 'balancetrack-bug-report-v1';
const AUTH_DRAFT_KEY = 'balancetrack-auth-v1';

const COLOR_SCHEMES = {
  fern: { themeColor: '#5f8f68' },
  ocean: { themeColor: '#2f7392' },
  sunrise: { themeColor: '#bf6e2c' },
  slate: { themeColor: '#46556d' },
};

const CUSTOM_THEME_VARIABLES = [
  '--bg',
  '--panel',
  '--panel-soft',
  '--border',
  '--text',
  '--muted',
  '--accent',
  '--accent-rgb',
  '--accent-2',
  '--accent-2-rgb',
  '--accent-strong',
  '--accent-soft',
];

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
      profile: {
        ...defaultState.profile,
        ...(parsed.profile || {}),
        location: (parsed.profile && (parsed.profile.location || parsed.profile.department)) || '',
      },
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

function normalizeColorScheme(colorScheme) {
  if (colorScheme === 'custom') return 'custom';
  return Object.prototype.hasOwnProperty.call(COLOR_SCHEMES, colorScheme) ? colorScheme : 'fern';
}

function normalizeCustomColor(rawColor) {
  const color = String(rawColor || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#5f8f68';
}

function hexToRgb(hexColor) {
  const color = normalizeCustomColor(hexColor);
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  };
}

function toRgbString({ r, g, b }) {
  return `${r}, ${g}, ${b}`;
}

function mixRgb(base, target, weight) {
  const w = Math.max(0, Math.min(1, weight));
  return {
    r: Math.round(base.r + (target.r - base.r) * w),
    g: Math.round(base.g + (target.g - base.g) * w),
    b: Math.round(base.b + (target.b - base.b) * w),
  };
}

function rgbToHex({ r, g, b }) {
  const red = Math.max(0, Math.min(255, r)).toString(16).padStart(2, '0');
  const green = Math.max(0, Math.min(255, g)).toString(16).padStart(2, '0');
  const blue = Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0');
  return `#${red}${green}${blue}`;
}

function clearCustomThemeVariables() {
  CUSTOM_THEME_VARIABLES.forEach((variable) => {
    document.documentElement.style.removeProperty(variable);
  });
}

function applyCustomTheme(customColor) {
  const accent = hexToRgb(customColor);
  const white = { r: 255, g: 255, b: 255 };
  const nearWhite = { r: 250, g: 252, b: 248 };
  const softGray = { r: 100, g: 114, b: 126 };
  const deepSlate = { r: 23, g: 33, b: 43 };

  const accent2 = mixRgb(accent, white, 0.36);
  const accentStrong = mixRgb(accent, deepSlate, 0.24);
  const bg = mixRgb(accent, nearWhite, 0.9);
  const panelSoft = mixRgb(accent, white, 0.95);
  const border = mixRgb(accent, white, 0.82);
  const muted = mixRgb(accent, softGray, 0.68);
  const text = mixRgb(accent, deepSlate, 0.84);

  document.documentElement.style.setProperty('--bg', rgbToHex(bg));
  document.documentElement.style.setProperty('--panel', '#ffffff');
  document.documentElement.style.setProperty('--panel-soft', rgbToHex(panelSoft));
  document.documentElement.style.setProperty('--border', rgbToHex(border));
  document.documentElement.style.setProperty('--text', rgbToHex(text));
  document.documentElement.style.setProperty('--muted', rgbToHex(muted));
  document.documentElement.style.setProperty('--accent', rgbToHex(accent));
  document.documentElement.style.setProperty('--accent-rgb', toRgbString(accent));
  document.documentElement.style.setProperty('--accent-2', rgbToHex(accent2));
  document.documentElement.style.setProperty('--accent-2-rgb', toRgbString(accent2));
  document.documentElement.style.setProperty('--accent-strong', rgbToHex(accentStrong));
  document.documentElement.style.setProperty('--accent-soft', `rgba(${toRgbString(accent)}, 0.16)`);
}

function applyColorScheme(colorScheme) {
  const normalizedScheme = normalizeColorScheme(colorScheme);
  const themeColorMetaEl = document.querySelector('meta[name="theme-color"]');

  if (normalizedScheme === 'custom') {
    const customColor = normalizeCustomColor(state.settings.customColor);
    state.settings.customColor = customColor;
    document.documentElement.dataset.theme = 'custom';
    applyCustomTheme(customColor);
    if (themeColorMetaEl) themeColorMetaEl.setAttribute('content', customColor);
    return normalizedScheme;
}

  clearCustomThemeVariables();
  document.documentElement.dataset.theme = normalizedScheme;
  if (themeColorMetaEl) {
    themeColorMetaEl.setAttribute('content', COLOR_SCHEMES[normalizedScheme].themeColor);
  }
  return normalizedScheme;
}

function renderThemeSwatches() {
  if (!themeSwatchesEl) return;
  const normalizedScheme = normalizeColorScheme(state.settings.colorScheme);
  const customColor = normalizeCustomColor(state.settings.customColor);

  themeSwatchesEl.querySelectorAll('.theme-swatch').forEach((swatch) => {
    const isActive = swatch.dataset.scheme === normalizedScheme;
    swatch.classList.toggle('active', isActive);
    swatch.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  const customSwatch = themeSwatchesEl.querySelector('.theme-swatch.custom');
  if (customSwatch) {
    customSwatch.style.background = `linear-gradient(135deg, ${customColor}, #ffffff)`;
  }
}

function populateStartingTtbOptions(selectEl) {
  if (!selectEl || selectEl.options.length) return;

  for (let hours = 0; hours <= 30; hours += 1) {
    const option = document.createElement('option');
    option.value = String(hours);
    option.textContent = `${hours}h`;
    selectEl.appendChild(option);
  }
}

function populateStartingTtbFractionOptions(selectEl) {
  if (!selectEl || selectEl.options.length) return;

  [
    { value: 0, label: '.00' },
    { value: 0.25, label: '.25' },
    { value: 0.5, label: '.50' },
    { value: 0.75, label: '.75' },
  ].forEach((value) => {
    const option = document.createElement('option');
    option.value = String(value.value);
    option.textContent = value.label;
    selectEl.appendChild(option);
  });
}

function getStartingTtbValueFromSelectors() {
  const hoursEl = document.getElementById('startingTtbHours');
  const fractionEl = document.getElementById('startingTtbFraction');
  const hours = Number(hoursEl?.value || 0);
  const fraction = Number(fractionEl?.value || 0);
  return Math.min(30, hours + fraction);
}

function syncStartingTtbFromSelectors() {
  state.settings.startingTtb = getStartingTtbValueFromSelectors();
  saveState();
}

function loadAuthDraft() {
  try {
    const raw = localStorage.getItem(AUTH_DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (authEmailEl && typeof draft.email === 'string') authEmailEl.value = draft.email;
    if (authPasswordEl && typeof draft.password === 'string') authPasswordEl.value = draft.password;
    if (rememberSignInEl) rememberSignInEl.checked = Boolean(draft.remember);
  } catch (error) {
    console.warn('Could not load saved sign-in details', error);
  }
}

function saveAuthDraft() {
  if (!rememberSignInEl?.checked) {
    localStorage.removeItem(AUTH_DRAFT_KEY);
    return;
  }

  localStorage.setItem(AUTH_DRAFT_KEY, JSON.stringify({
    email: String(authEmailEl?.value || '').trim(),
    password: String(authPasswordEl?.value || ''),
    remember: true,
  }));
}

function clearAuthDraft() {
  localStorage.removeItem(AUTH_DRAFT_KEY);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getProfileDetails() {
  return {
    staffName: String(state.profile.staffName || '').trim(),
    managerName: String(state.profile.managerName || '').trim(),
    managerEmail: String(state.profile.managerEmail || '').trim(),
    location: String(state.profile.location || '').trim(),
  };
}

function rowsToPlainText(rows) {
  return rows.map((row) => row.map((cell) => String(cell ?? '')).join(' | ')).join('\n');
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function buildSheetRows() {
  const profile = getProfileDetails();
  const earnedTtbEntries = state.entries
    .filter((entry) => entry.type === 'ttb' && entry.action === 'earned')
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!earnedTtbEntries.length) {
    throw new Error('No earned TTB entries available to export yet.');
  }

  const rows = [
    ['BalanceTrack Export', '', ''],
    ['Staff name', profile.staffName || 'Not provided', ''],
    ['Manager name', profile.managerName || 'Not provided', ''],
    ['Manager email', profile.managerEmail || 'Not provided', ''],
    ['Location', profile.location || 'Not provided', ''],
    ['', '', ''],
    ['Date', 'TTB added (hours)', 'Reason'],
  ];

  let totalHours = 0;
  earnedTtbEntries.forEach((entry) => {
    const hours = Number(entry.amount || 0);
    totalHours += hours;
    rows.push([
      formatDate(entry.date),
      formatHoursValue(hours),
      entry.note || 'No reason entered',
    ]);
  });

  rows.push(['', '', '']);
  rows.push(['TOTAL', formatHoursValue(totalHours), '']);
  return rows;
}

function buildSheetPreviewHtml(title, rows) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #182026; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0 0 18px; color: #55606a; }
    table { width: 100%; border-collapse: collapse; }
    td { border: 1px solid #d6ddd8; padding: 8px 10px; vertical-align: top; }
    tr:nth-child(odd) td { background: #f8fbf7; }
    .meta td:first-child { font-weight: 700; width: 180px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Open this sheet in the browser, or use the app buttons to download or email it.</p>
  <table>
    ${rows.map((row, index) => `<tr class="${index < 5 ? 'meta' : ''}">${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
  </table>
</body>
</html>`;
}

function openSheetInBrowser(title, rows) {
  const previewHtml = buildSheetPreviewHtml(title, rows);
  const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (!previewWindow) {
    URL.revokeObjectURL(url);
    window.alert('Please allow popups to open the export sheet in a browser tab.');
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadSheet(format, rows) {
  const exportDate = formatLocalDate(new Date());
  if (format === 'csv') {
    downloadCsvFile(`ttb-export-${exportDate}.csv`, rows);
    return;
  }

  if (format === 'excel') {
    downloadTextFile(`ttb-export-${exportDate}.xls`, buildSheetPreviewHtml('TTB Export', rows), 'application/vnd.ms-excel');
    return;
  }

  if (format === 'word') {
    downloadTextFile(`ttb-export-${exportDate}.doc`, buildSheetPreviewHtml('TTB Export', rows), 'application/msword');
    return;
  }

  if (format === 'pdf') {
    openSheetInBrowser('TTB Export', rows);
    return;
  }

  throw new Error('Unsupported export format.');
}

function emailSheet(format, rows) {
  const profile = getProfileDetails();
  if (!profile.managerEmail) {
    window.alert('Enter the manager email in Settings first.');
    return;
  }

  const subject = `BalanceTrack export - ${format.toUpperCase()}`;
  const body = rowsToPlainText(rows);
  const mailto = `mailto:${encodeURIComponent(profile.managerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
}

async function showChoiceDialog(title, message, options) {
  if (!choiceDialogEl || !choiceDialogTitleEl || !choiceDialogMessageEl || !choiceDialogActionsEl) {
    return null;
  }

  return new Promise((resolve) => {
    const finish = (value) => {
      if (choiceDialogEl.open) {
        choiceDialogEl.close();
      }
      choiceDialogActionsEl.innerHTML = '';
      choiceDialogEl.removeEventListener('cancel', cancelHandler);
      resolve(value);
    };

    const cancelHandler = (event) => {
      event.preventDefault();
      finish(null);
    };

    choiceDialogTitleEl.textContent = title;
    choiceDialogMessageEl.textContent = message || '';
    choiceDialogActionsEl.innerHTML = '';

    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn ${option.variant || 'btn-secondary'}`;
      button.textContent = option.label;
      button.addEventListener('click', () => finish(option.value));
      choiceDialogActionsEl.appendChild(button);
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-ghost';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => finish(null));
    choiceDialogActionsEl.appendChild(cancelButton);

    choiceDialogEl.addEventListener('cancel', cancelHandler);
    choiceDialogEl.showModal();
  });
}

function buildBugReportMessage(details) {
  const accountEmail = String(authEmailEl?.value || '').trim() || 'Not provided';
  const category = String(bugReportCategoryEl?.value || 'general');
  const severity = String(bugReportSeverityEl?.value || 'medium');
  const lines = [
    'Issue details:',
    details,
    '',
    'Context:',
    `Category: ${category}`,
    `Severity: ${severity}`,
    `Account email: ${accountEmail}`,
    `URL: ${window.location.href}`,
    `User agent: ${navigator.userAgent}`,
    `Time: ${new Date().toISOString()}`,
  ];
  return lines.join('\n');
}

function buildBugReportMailto(details) {
  const subject = 'BalanceTrack bug report';
  const body = buildBugReportMessage(details);
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function setBugReportStatus(message, isError = false) {
  if (!bugReportStatusEl) return;
  bugReportStatusEl.hidden = false;
  bugReportStatusEl.textContent = message;
  bugReportStatusEl.classList.toggle('error', isError);
  bugReportStatusEl.classList.toggle('success', !isError);
}

function clearBugReportStatus() {
  if (!bugReportStatusEl) return;
  bugReportStatusEl.hidden = true;
  bugReportStatusEl.textContent = '';
  bugReportStatusEl.classList.remove('error', 'success');
}

function updateBugReportCount() {
  if (!bugReportCountEl) return;
  const length = String(bugReportDetailsEl?.value || '').length;
  bugReportCountEl.textContent = `${length} / 1000`;
}

function saveBugReportDraft() {
  const payload = {
    category: String(bugReportCategoryEl?.value || 'general'),
    severity: String(bugReportSeverityEl?.value || 'medium'),
    details: String(bugReportDetailsEl?.value || ''),
  };
  localStorage.setItem(BUG_REPORT_DRAFT_KEY, JSON.stringify(payload));
}

function loadBugReportDraft() {
  try {
    const raw = localStorage.getItem(BUG_REPORT_DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (bugReportCategoryEl && typeof draft.category === 'string') {
      bugReportCategoryEl.value = draft.category;
    }
    if (bugReportSeverityEl && typeof draft.severity === 'string') {
      bugReportSeverityEl.value = draft.severity;
    }
    if (bugReportDetailsEl && typeof draft.details === 'string') {
      bugReportDetailsEl.value = draft.details;
    }
    updateBugReportCount();
  } catch (_error) {
    // Ignore malformed draft content
  }
}

function loadAuthDraft() {
  try {
    const raw = localStorage.getItem(AUTH_DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (authEmailEl && typeof draft.email === 'string') authEmailEl.value = draft.email;
    if (authPasswordEl && typeof draft.password === 'string') authPasswordEl.value = draft.password;
    if (rememberSignInEl) rememberSignInEl.checked = Boolean(draft.remember);
  } catch (error) {
    console.warn('Could not load saved sign-in details', error);
  }
}

function saveAuthDraft() {
  if (!rememberSignInEl?.checked) {
    localStorage.removeItem(AUTH_DRAFT_KEY);
    return;
  }

  localStorage.setItem(AUTH_DRAFT_KEY, JSON.stringify({
    email: String(authEmailEl?.value || '').trim(),
    password: String(authPasswordEl?.value || ''),
    remember: true,
  }));
}

function clearAuthDraft() {
  localStorage.removeItem(AUTH_DRAFT_KEY);
}

async function sendBugReport(details) {
  const senderEmail = String(authEmailEl?.value || '').trim();
  const payload = {
    _subject: 'BalanceTrack bug report',
    _captcha: 'false',
    _template: 'table',
    email: senderEmail || 'noreply@balancetrack.local',
    message: buildBugReportMessage(details),
  };

  const response = await fetch(BUG_REPORT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`request failed (${response.status})`);
  }

  const result = await response.json().catch(() => ({}));
  if (result.success === 'false') {
    throw new Error(result.message || 'mail service rejected request');
  }
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

function updateAuthUI(user) {
  if (authSignUpBtn) authSignUpBtn.hidden = Boolean(user);
  if (authSignInBtn) authSignInBtn.hidden = Boolean(user);
  if (authSignOutBtn) authSignOutBtn.hidden = !user;
}

async function connectSupabase() {
  if (!window.supabase?.createClient) {
    setAuthStatus('Supabase library failed to load. Refresh and try again.', true);
    return null;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  if (!authListenerAttached) {
    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      updateAuthUI(session?.user || null);
      currentUserId = session?.user?.id || null;
      if (currentUserId) {
        if (authEmailEl) {
          authEmailEl.value = session.user.email || authEmailEl.value;
        }
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
  const normalizedTime = String(time).trim();
  const explicitMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(normalizedTime);
  if (explicitMatch) {
    let hours = Number(explicitMatch[1]);
    const minutes = Number(explicitMatch[2]);
    if (explicitMatch[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (explicitMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const [hours, minutes] = normalizedTime.split(':').map(Number);
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

function formatHoursValue(hours, precision = 2) {
  return Number(hours || 0).toFixed(precision);
}

function formatQuarterHoursValue(hours) {
  return Number(hours || 0)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function formatTtbAmount(hours) {
  return `${formatHoursValue(hours)}h`;
}

function formatAmount(type, amount, action) {
  const sign = action === 'used' ? '-' : '+';
  if (type === 'day') return `${sign}${Number(amount).toFixed(2)}d`;
  return `${sign}${formatTtbAmount(amount)}`;
}

function formatTimeForDisplay(timeValue, overrideFormat) {
  if (!timeValue) return '';
  const use12Hour = overrideFormat ? overrideFormat === '12h' : state.settings.timeFormat === '12h';
  const normalizedValue = String(timeValue).trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalizedValue);
  if (!match) {
    const twelveHourMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(normalizedValue);
    if (twelveHourMatch) {
      return normalizedValue.replace(/\s+/g, ' ');
    }
    return normalizedValue;
  }

  const hours = Number(match[1]);
  const minutes = match[2];
  if (!use12Hour) {
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelveHour}:${minutes} ${suffix}`;
}

function parseDisplayTime(rawValue, overrideFormat) {
  const textValue = String(rawValue || '').trim();
  if (!textValue) return '';

  const use12Hour = overrideFormat ? overrideFormat === '12h' : state.settings.timeFormat === '12h';
  const explicitMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(textValue);
  if (explicitMatch) {
    let hours = Number(explicitMatch[1]);
    const minutes = Number(explicitMatch[2]);
    if (minutes % 15 !== 0) return null;
    if (explicitMatch[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (explicitMatch[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const simpleMatch = /^(\d{1,2}):(\d{2})$/.exec(textValue);
  if (simpleMatch) {
    const hours = Number(simpleMatch[1]);
    const minutes = Number(simpleMatch[2]);
    if (minutes % 15 !== 0) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return null;
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

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildTtbExportRows() {
  return buildSheetRows();
}

function exportTtbReport(format = 'csv') {
  const rows = buildSheetRows();
  const exportDate = formatLocalDate(new Date());

  if (format === 'browser') {
    openSheetInBrowser('TTB Export', rows);
    return;
  }

  if (format === 'email') {
    emailSheet('csv', rows);
    return;
  }

  downloadSheet(format, rows);
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
  if (ttbBalanceEl) ttbBalanceEl.textContent = `${formatHoursValue(ttbHours)}h`;
  if (ttbBalanceDaysEl) ttbBalanceDaysEl.textContent = `${ttbDays.toFixed(2)} days`;
  if (dayBalanceEl) dayBalanceEl.textContent = `${formatHoursValue(balances.day)}d`;

  const { totalWorked, totalOT } = recalculateTimesheet();
  if (fortnightSummaryEl) fortnightSummaryEl.textContent = `${formatHoursValue(totalWorked)}h worked`;
  if (fortnightOtEl) fortnightOtEl.textContent = `${formatHoursValue(totalOT)}h OT accrued`;

  if (latestEntryEl) {
    latestEntryEl.textContent = latest ? `${latest.type === 'ttb' ? 'TTB' : 'Days in lieu'} · ${formatDate(latest.date)}` : 'No entries yet';
  }
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
            <input type="time" data-field="start" value="${day.start || ''}" ${day.isWeekend ? 'disabled' : ''} step="900" />
          </label>
          <label class="time-input">
            <span>Finish</span>
            <input type="time" data-field="finish" value="${day.finish || ''}" ${day.isWeekend ? 'disabled' : ''} step="900" />
          </label>
          <div class="hours-pill">${formatQuarterHoursValue(daySummary.workedHours)}h</div>
          <div class="ot-pill">${formatQuarterHoursValue(daySummary.overtime)}h OT</div>
        </div>
      `;
    })
    .join('');
}

function renderProfile() {
  document.getElementById('staffName').value = state.profile.staffName;
  document.getElementById('managerName').value = state.profile.managerName;
  if (managerEmailEl) managerEmailEl.value = state.profile.managerEmail || '';
  if (locationEl) locationEl.value = state.profile.location || '';
  document.getElementById('role').value = state.profile.role;
  const startingTtbValue = Number(state.settings.startingTtb || 0);
  const startingTtbHours = Math.max(0, Math.min(30, Math.floor(startingTtbValue)));
  const startingTtbFraction = Number((startingTtbValue - startingTtbHours).toFixed(2));
  const startingTtbHoursEl = document.getElementById('startingTtbHours');
  const startingTtbFractionEl = document.getElementById('startingTtbFraction');
  populateStartingTtbOptions(startingTtbHoursEl);
  populateStartingTtbFractionOptions(startingTtbFractionEl);
  if (startingTtbHoursEl) startingTtbHoursEl.value = String(startingTtbHours);
  if (startingTtbFractionEl) startingTtbFractionEl.value = String([0, 0.25, 0.5, 0.75].includes(startingTtbFraction) ? startingTtbFraction : 0);
  document.getElementById('startingDay').value = state.settings.startingDay;
  document.getElementById('defaultStartTime').value = state.settings.defaultStartTime || '08:00';
  document.getElementById('defaultFinishTime').value = state.settings.defaultFinishTime || '16:30';
  document.getElementById('timeFormat').value = state.settings.timeFormat || '12h';
  const normalizedScheme = normalizeColorScheme(state.settings.colorScheme);
  if (colorSchemeEl) colorSchemeEl.value = normalizedScheme;
  if (customColorInputEl) {
    customColorInputEl.value = normalizeCustomColor(state.settings.customColor);
    customColorInputEl.disabled = normalizedScheme !== 'custom';
  }
  renderThemeSwatches();
}

function render() {
  state.settings.colorScheme = applyColorScheme(state.settings.colorScheme);
  ensureTimesheetDays();
  renderDashboard();
  renderEntries();
  const settingsForm = document.getElementById('settingsForm');
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

async function addTtbQuickEntry(action) {
  const rawValue = window.prompt('Enter TTB amount in quarter-hour steps (0.25, 0.5, 0.75, 1, etc.)', '0.25');
  if (rawValue === null) return;
  const parsedValue = parseQuarterHourValue(rawValue);
  if (!parsedValue) {
    window.alert('Please enter a positive value in quarter-hour increments such as 0.25, 0.5, 0.75, or 1.');
    return;
  }

  let note = action === 'earned' ? 'Quick TTB add' : 'Quick TTB use';
  if (action === 'earned') {
    const selectedReason = await showChoiceDialog(
      'Why is TTB being added?',
      'Choose the matching reason below.',
      [
        { label: 'No lunch taken', value: 'No lunch taken' },
        { label: 'Additional travel due to traffic/accident', value: 'Additional travel due to traffic/accident' },
        { label: 'Extra time worked', value: 'Extra time worked' },
      ]
    );

    if (!selectedReason) return;

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

      const extraReason = window.prompt('Add a reason for this extra time worked', 'Extra time worked');
      if (extraReason === null) return;

      const applied = applyExtraTimeToDate(normalizedDate, parsedValue);
      if (!applied) {
        window.alert('Could not apply extra time to that date. Please try again.');
        return;
      }

      note = `${selectedReason} (${normalizedDate}) - ${String(extraReason).trim() || 'No reason entered'}`;
    } else {
      note = selectedReason;
    }
  }

  addEntry('ttb', action, parsedValue, note);
}

addTtbBtn?.addEventListener('click', () => addTtbQuickEntry('earned'));
useTtbBtn?.addEventListener('click', () => addTtbQuickEntry('used'));
addDayBtn?.addEventListener('click', () => addEntry('day', 'earned', 1, 'Quick day add'));
useDayBtn?.addEventListener('click', () => addEntry('day', 'used', 1, 'Quick day use'));

prevFortnightBtn?.addEventListener('click', () => {
  const anchor = parseLocalDate(state.currentFortnightKey || getFortnightKey(getMondayOfCurrentWeek()));
  anchor.setDate(anchor.getDate() - 14);
  setCurrentFortnight(anchor);
  render();
});

nextFortnightBtn?.addEventListener('click', () => {
  const anchor = parseLocalDate(state.currentFortnightKey || getFortnightKey(getMondayOfCurrentWeek()));
  anchor.setDate(anchor.getDate() + 14);
  setCurrentFortnight(anchor);
  render();
});

resetSelectedFortnightBtn?.addEventListener('click', () => {
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

exportTtbBtn?.addEventListener('click', async () => {
  const action = await showChoiceDialog(
    'Export TTB sheet',
    'Choose how you want to share the export.',
    [
      { label: 'Open in browser', value: 'browser' },
      { label: 'Download file', value: 'download' },
      { label: 'Email manager', value: 'email' },
    ]
  );
  if (!action) return;

  try {
    const rows = buildSheetRows();
    if (action === 'browser') {
      openSheetInBrowser('TTB Export', rows);
      return;
    }

    if (action === 'email') {
      emailSheet('csv', rows);
      return;
    }

    const format = await showChoiceDialog(
      'Download format',
      'Pick the file format for the export.',
      [
        { label: 'Excel', value: 'excel' },
        { label: 'Word', value: 'word' },
        { label: 'PDF', value: 'pdf' },
        { label: 'CSV', value: 'csv' },
      ]
    );
    if (!format) return;

    downloadSheet(format, rows);
  } catch (error) {
    window.alert(error.message || 'Could not export TTB data.');
  }
});

sendBugReportBtn?.addEventListener('click', () => {
  const details = String(bugReportDetailsEl?.value || '').trim();
  if (!details) {
    setBugReportStatus('Please describe the issue before sending.', true);
    return;
  }

  if (sendBugReportBtn) {
    sendBugReportBtn.disabled = true;
    sendBugReportBtn.setAttribute('aria-busy', 'true');
  }
  setBugReportStatus('Sending bug report...');

  (async () => {
    try {
      await sendBugReport(details);
      setBugReportStatus(`Bug report sent to ${SUPPORT_EMAIL}.`);
      if (bugReportDetailsEl) {
        bugReportDetailsEl.value = '';
        saveBugReportDraft();
        updateBugReportCount();
      }
    } catch (error) {
      setBugReportStatus(`Could not send automatically (${error.message}). Opening email draft instead.`, true);
      window.location.href = buildBugReportMailto(details);
    } finally {
      if (sendBugReportBtn) {
        sendBugReportBtn.disabled = false;
        sendBugReportBtn.setAttribute('aria-busy', 'false');
      }
    }
  })();
});

bugReportDetailsEl?.addEventListener('input', () => {
  saveBugReportDraft();
  updateBugReportCount();
  clearBugReportStatus();
});

bugReportCategoryEl?.addEventListener('change', () => {
  saveBugReportDraft();
  clearBugReportStatus();
});

bugReportSeverityEl?.addEventListener('change', () => {
  saveBugReportDraft();
  clearBugReportStatus();
});

copyBugReportBtn?.addEventListener('click', () => {
  const details = String(bugReportDetailsEl?.value || '').trim();
  if (!details) {
    setBugReportStatus('Add issue details before copying the report.', true);
    return;
  }

  const message = buildBugReportMessage(details);
  navigator.clipboard.writeText(message)
    .then(() => {
      setBugReportStatus('Report details copied to clipboard.');
    })
    .catch((error) => {
      setBugReportStatus(`Could not copy report (${error.message}).`, true);
    });
});

authSignUpBtn?.addEventListener('click', () => {
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

authSignInBtn?.addEventListener('click', () => {
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
    saveAuthDraft();
    await pullStateFromCloud();
  })();
});

authSignOutBtn?.addEventListener('click', () => {
  (async () => {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
    currentUserId = null;
    if (authEmailEl) authEmailEl.value = '';
    if (authPasswordEl) authPasswordEl.value = '';
    if (!rememberSignInEl?.checked) {
      clearAuthDraft();
    }
    setAuthStatus('Signed out. CSV export remains available as backup.');
  })();
});

tabButtons.forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

profileForm?.addEventListener('input', (event) => {
  const { name, value } = event.target;
  state.profile[name] = value;
  saveState();
});

authEmailEl?.addEventListener('input', saveAuthDraft);
authPasswordEl?.addEventListener('input', saveAuthDraft);
rememberSignInEl?.addEventListener('change', saveAuthDraft);

const handleSettingsFormChange = (event) => {
  const { name, value } = event.target;
  if (name === 'colorScheme') {
    state.settings.colorScheme = normalizeColorScheme(value);
    state.settings.colorScheme = applyColorScheme(state.settings.colorScheme);
  } else if (name === 'customColor') {
    state.settings.customColor = normalizeCustomColor(value);
    state.settings.colorScheme = 'custom';
    state.settings.colorScheme = applyColorScheme('custom');
  } else if (name === 'startingTtbHours' || name === 'startingTtbFraction' || name === 'startingDay') {
    if (name === 'startingTtbHours' || name === 'startingTtbFraction') {
      state.settings.startingTtb = getStartingTtbValueFromSelectors();
    } else {
      const parsed = parseQuarterHourValue(value);
      state.settings[name] = parsed ?? 0;
    }
  } else if (name === 'defaultStartTime' || name === 'defaultFinishTime') {
    state.settings[name] = value;
  } else if (name === 'timeFormat') {
    state.settings.timeFormat = value === '24h' ? '24h' : '12h';
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
};

settingsForm?.addEventListener('input', handleSettingsFormChange);
settingsForm?.addEventListener('change', handleSettingsFormChange);

themeSwatchesEl?.addEventListener('click', (event) => {
  const swatch = event.target.closest('.theme-swatch');
  if (!swatch) return;

  const scheme = normalizeColorScheme(swatch.dataset.scheme || 'fern');
  state.settings.colorScheme = scheme;
  state.settings.colorScheme = applyColorScheme(scheme);
  saveState();
  render();
});

timesheetDaysEl?.addEventListener('change', (event) => {
  const row = event.target.closest('.timesheet-row');
  if (!row) return;

  const index = Number(row.dataset.index);
  const field = event.target.dataset.field;
  const day = state.timesheetDays[index];
  if (!day) return;

  const parsedTime = parseDisplayTime(event.target.value, state.settings.timeFormat);
  if (parsedTime === null) {
    window.alert('Please enter times in 15-minute blocks only (00, 15, 30, 45).');
    event.target.value = formatTimeForDisplay(day[field]);
    return;
  }

  day[field] = parsedTime;
  saveCurrentFortnight();

  const daySummary = calculateDayHours(day);
  const hoursPill = row.querySelector('.hours-pill');
  const otPill = row.querySelector('.ot-pill');
  if (hoursPill) {
    hoursPill.textContent = `${formatQuarterHoursValue(daySummary.workedHours)}h`;
  }
  if (otPill) {
    otPill.textContent = `${formatQuarterHoursValue(daySummary.overtime)}h OT`;
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
loadBugReportDraft();
loadAuthDraft();
updateBugReportCount();

connectSupabase().catch((error) => {
  setAuthStatus(`Connect failed: ${error.message}`, true);
});
