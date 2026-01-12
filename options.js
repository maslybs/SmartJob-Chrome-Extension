const defaultScoreSettings = {
  enabled: true,
  hireRateMin: 60,
  hireRateTarget: 70,
  budgetTarget: 1000,
  clientPaidTarget: 5000,
  clientRatingTarget: 4.5,
  weights: {
    hireRate: 5,
    clientPaid: 4,
    clientCountry: 3,
    budget: 3,
    clientRating: 3,
    paymentVerified: 1,
    experience: 1,
    proposals: 0.5,
    time: 0.5,
    postingTime: 0.5,
    featured: 0.5,
  },
  countryPreferredScore: 10,
  countryOtherScore: 0,
  preferredCountries: [
    'Australia',
    'Austria',
    'Belgium',
    'Canada',
    'Cyprus',
    'Czech Republic',
    'Denmark',
    'Estonia',
    'Finland',
    'France',
    'Germany',
    'Greenland',
    'Israel',
    'Italy',
    'Japan',
    'Latvia',
    'Liechtenstein',
    'Lithuania',
    'Luxembourg',
    'Monaco',
    'Netherlands',
    'New Zealand',
    'Norway',
    'San Marino',
    'Singapore',
    'Slovakia',
    'Swaziland',
    'Sweden',
    'Switzerland',
    'United Kingdom',
    'United States',
  ],
};

const defaultLlmSettings = {
  apiKey: '',
  model: 'z-ai/glm-4.5-air:free',
  prompt: 'Ти кар\'єрний асистент Full-stack розробника та технічного архітектора. Профіль: MVP, AI-інтеграції, швидке прототипування, прагматичні рішення без over-engineering. Стек: Next.js/React/TypeScript, Node.js/FastAPI, PostgreSQL/Supabase/Redis, n8n/Webhooks, OpenAI/Gemini/LangChain, Docker, Cloudflare, OAuth/Stripe, Electron/Tauri. Оціни завдання під мій профіль (веб/MVP/desktop), складність vs бюджет, вимоги до стека, ризики та чіткість ТЗ. Відповідь українською у форматі: "ВАРТО" або "НЕ ВАРТО" і завжди 2-4 конкретні причини. Якщо даних мало, все одно дай рішення і поясни припущення.',
};

const defaultCheckboxes = {
  checkboxHireRate: true,
  checkboxConnectsRequired: true,
  checkboxMemberSince: true,
  checkboxAutoLoad: true,
};

const scoreEnabledEl = document.getElementById('scoreEnabled');
const preferredCountriesEl = document.getElementById('preferredCountries');
const preferredScoreEl = document.getElementById('countryPreferredScore');
const otherScoreEl = document.getElementById('countryOtherScore');
const hireRateMinEl = document.getElementById('hireRateMin');
const hireRateTargetEl = document.getElementById('hireRateTarget');
const budgetTargetEl = document.getElementById('budgetTarget');
const clientPaidTargetEl = document.getElementById('clientPaidTarget');
const clientRatingTargetEl = document.getElementById('clientRatingTarget');
const openrouterApiKeyEl = document.getElementById('openrouterApiKey');
const openrouterModelEl = document.getElementById('openrouterModel');
const openrouterPromptEl = document.getElementById('openrouterPrompt');
const testModelEl = document.getElementById('testModel');
const testResultEl = document.getElementById('testResult');
const weightInputs = Array.from(document.querySelectorAll('[data-weight]'));
const statusEl = document.getElementById('status');
const checkboxInputs = Object.keys(defaultCheckboxes).map(key => document.getElementById(key));

function mergeScoreSettings(rawSettings) {
  const settings = rawSettings || {};
  const weights = { ...defaultScoreSettings.weights, ...(settings.weights || {}) };
  const preferredCountries = Array.isArray(settings.preferredCountries)
    ? settings.preferredCountries
    : defaultScoreSettings.preferredCountries;

  return {
    ...defaultScoreSettings,
    ...settings,
    weights,
    preferredCountries,
  };
}

function parseCountries(text) {
  return text
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function formatCountries(countries) {
  return (countries || []).join(', ');
}

function toNumber(value, fallback) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function setStatus(message) {
  statusEl.textContent = message;
  if (!message) return;
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
}

function setTestResult(message, tone) {
  if (!testResultEl) return;
  testResultEl.textContent = message || '';
  testResultEl.classList.remove('good', 'bad');
  if (tone === 'good') testResultEl.classList.add('good');
  if (tone === 'bad') testResultEl.classList.add('bad');
}

function updateRangeValue(input) {
  const key = input.dataset.weight;
  const valueEl = document.querySelector(`[data-value-for="${key}"]`);
  if (valueEl) {
    valueEl.textContent = input.value;
  }
}

function applySettings(settings, checkboxes, llmSettings) {
  scoreEnabledEl.checked = settings.enabled !== false;
  preferredCountriesEl.value = formatCountries(settings.preferredCountries);
  preferredScoreEl.value = toNumber(settings.countryPreferredScore, defaultScoreSettings.countryPreferredScore);
  otherScoreEl.value = toNumber(settings.countryOtherScore, defaultScoreSettings.countryOtherScore);
  hireRateMinEl.value = toNumber(settings.hireRateMin, defaultScoreSettings.hireRateMin);
  hireRateTargetEl.value = toNumber(settings.hireRateTarget, defaultScoreSettings.hireRateTarget);
  budgetTargetEl.value = toNumber(settings.budgetTarget, defaultScoreSettings.budgetTarget);
  clientPaidTargetEl.value = toNumber(settings.clientPaidTarget, defaultScoreSettings.clientPaidTarget);
  clientRatingTargetEl.value = toNumber(settings.clientRatingTarget, defaultScoreSettings.clientRatingTarget);
  openrouterApiKeyEl.value = llmSettings.apiKey || '';
  openrouterModelEl.value = llmSettings.model || defaultLlmSettings.model;
  openrouterPromptEl.value = llmSettings.prompt || defaultLlmSettings.prompt;

  weightInputs.forEach(input => {
    const key = input.dataset.weight;
    input.value = toNumber(settings.weights[key], defaultScoreSettings.weights[key]);
    updateRangeValue(input);
  });

  checkboxInputs.forEach(input => {
    if (!input) return;
    const key = input.id;
    input.checked = checkboxes[key] ?? defaultCheckboxes[key];
  });
}

function collectSettings() {
  const weights = { ...defaultScoreSettings.weights };
  weightInputs.forEach(input => {
    const key = input.dataset.weight;
    weights[key] = toNumber(input.value, defaultScoreSettings.weights[key]);
  });

  return {
    enabled: scoreEnabledEl.checked,
    hireRateMin: toNumber(hireRateMinEl.value, defaultScoreSettings.hireRateMin),
    hireRateTarget: toNumber(hireRateTargetEl.value, defaultScoreSettings.hireRateTarget),
    budgetTarget: toNumber(budgetTargetEl.value, defaultScoreSettings.budgetTarget),
    clientPaidTarget: toNumber(clientPaidTargetEl.value, defaultScoreSettings.clientPaidTarget),
    clientRatingTarget: toNumber(clientRatingTargetEl.value, defaultScoreSettings.clientRatingTarget),
    weights,
    countryPreferredScore: toNumber(preferredScoreEl.value, defaultScoreSettings.countryPreferredScore),
    countryOtherScore: toNumber(otherScoreEl.value, defaultScoreSettings.countryOtherScore),
    preferredCountries: parseCountries(preferredCountriesEl.value),
  };
}

function collectCheckboxes() {
  const checkboxes = { ...defaultCheckboxes };
  checkboxInputs.forEach(input => {
    if (!input) return;
    checkboxes[input.id] = input.checked;
  });
  return checkboxes;
}

function collectLlmSettings() {
  return {
    apiKey: (openrouterApiKeyEl.value || '').trim(),
    model: (openrouterModelEl.value || defaultLlmSettings.model).trim(),
    prompt: (openrouterPromptEl.value || defaultLlmSettings.prompt).trim(),
  };
}

async function testModel() {
  const llmSettings = collectLlmSettings();
  if (!llmSettings.apiKey) {
    setTestResult('Вкажіть API ключ', 'bad');
    return;
  }

  setTestResult('Тестую...', '');
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'smartjob:test-model',
      settings: llmSettings,
      payload: {
        title: 'Тестове завдання',
        description: 'Потрібно оцінити, чи варто брати роботу.',
        skills: 'JavaScript, API',
        url: 'https://www.upwork.com/',
      },
    });

    if (!response?.ok) {
      if (response?.error === 'data_policy') {
        setTestResult(response?.details || 'Політика даних OpenRouter', 'bad');
      } else {
        setTestResult(response?.details || response?.error || 'Помилка запиту', 'bad');
      }
      return;
    }

    const preview = response?.content?.trim();
    if (!preview) {
      setTestResult('Порожня відповідь від моделі', 'bad');
      return;
    }
    setTestResult(preview.slice(0, 140), 'good');
  } catch (error) {
    setTestResult(error?.message || 'Помилка запиту', 'bad');
  }
}

async function loadSettings() {
  const result = await chrome.storage.local.get(['scoreSettings', 'checkboxes', 'llmSettings']);
  const settings = mergeScoreSettings(result.scoreSettings);
  const checkboxes = { ...defaultCheckboxes, ...(result.checkboxes || {}) };
  const llmSettings = { ...defaultLlmSettings, ...(result.llmSettings || {}) };
  applySettings(settings, checkboxes, llmSettings);
}

async function saveSettings() {
  const settings = collectSettings();
  const checkboxes = collectCheckboxes();
  const llmSettings = collectLlmSettings();
  await chrome.storage.local.set({ scoreSettings: settings, checkboxes, llmSettings });
  setStatus('Збережено');
}

document.getElementById('save').addEventListener('click', saveSettings);
document.getElementById('reset').addEventListener('click', async () => {
  applySettings(defaultScoreSettings, defaultCheckboxes, defaultLlmSettings);
  await chrome.storage.local.set({
    scoreSettings: defaultScoreSettings,
    checkboxes: defaultCheckboxes,
    llmSettings: defaultLlmSettings,
  });
  setStatus('Скинуто до стандартних');
});

weightInputs.forEach(input => {
  input.addEventListener('input', () => updateRangeValue(input));
});

if (testModelEl) {
  testModelEl.addEventListener('click', testModel);
}

loadSettings();
