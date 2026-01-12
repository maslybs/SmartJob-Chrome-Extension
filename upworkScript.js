// FIXME: Use JS Bundler
const checkboxes = {
    'checkboxHireRate': true,
    'checkboxConnectsRequired': true,
    'checkboxMemberSince': true,
    'checkboxAutoLoad': true,
};

const FETCH_BASE_DELAY_MIN_MS = 1000;
const FETCH_BASE_DELAY_MAX_MS = 3000;
const FETCH_TTL_MS = 5 * 60 * 1000;
const FETCH_ERROR_DELAY_MS = 10000;
const FETCH_ERROR_MAX_DELAY_MS = 60000;
const FETCH_ERROR_DELAY_MULTIPLIER = 1.7;
const FETCH_MAX_PER_RUN = 8;
const FETCH_MAX_QUEUE = 12;
const SCROLL_DEBOUNCE_MS = 600;
const DETAILS_CACHE_KEY = 'jobDetailsCache';
const DETAILS_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const DETAILS_CACHE_MAX = 200;
const EVAL_CACHE_KEY = 'smartjobEvalCache';
const EVAL_CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const EVAL_CACHE_MAX = 300;
const fetchCache = new Map();
const fetchInFlight = new Map();
const fetchQueue = [];
let fetchActive = false;
let fetchDelayMs = getRandomDelay(FETCH_BASE_DELAY_MIN_MS, FETCH_BASE_DELAY_MAX_MS);
let fetchErrorDelayMs = FETCH_ERROR_DELAY_MS;
let fetchBlocked = false;
let fetchBlockedReason = '';
let detailsCache = null;
let detailsCacheSaveTimer = null;

function getCachedHtml(url) {
    const cached = fetchCache.get(url);
    if (!cached) return null;
    if (Date.now() - cached.ts > FETCH_TTL_MS) {
        fetchCache.delete(url);
        return null;
    }
    return cached.html;
}

function getRandomDelay(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
}

function resetFetchDelay() {
    fetchDelayMs = getRandomDelay(FETCH_BASE_DELAY_MIN_MS, FETCH_BASE_DELAY_MAX_MS);
    fetchErrorDelayMs = FETCH_ERROR_DELAY_MS;
}

function applyFetchBackoff() {
    fetchDelayMs = Math.max(fetchDelayMs, fetchErrorDelayMs);
    fetchErrorDelayMs = Math.min(
        FETCH_ERROR_MAX_DELAY_MS,
        Math.round(fetchErrorDelayMs * FETCH_ERROR_DELAY_MULTIPLIER)
    );
}

function markFetchBlocked(reason) {
    fetchBlocked = true;
    fetchBlockedReason = reason || 'fetch_blocked';
}

function isFetchBlocked() {
    return fetchBlocked;
}

function enqueueFetch(url) {
    if (isFetchBlocked()) {
        return Promise.resolve(null);
    }
    if (fetchQueue.length >= FETCH_MAX_QUEUE) {
        return Promise.reject(new Error('fetch_queue_full'));
    }
    const inFlight = fetchInFlight.get(url);
    if (inFlight) return inFlight;
    const promise = new Promise((resolve, reject) => {
        fetchQueue.push({ url, resolve, reject });
        processFetchQueue();
    });
    fetchInFlight.set(url, promise);
    promise.finally(() => {
        fetchInFlight.delete(url);
    });
    return promise;
}

async function processFetchQueue() {
    if (fetchActive) return;
    fetchActive = true;
    while (fetchQueue.length) {
        const { url, resolve, reject } = fetchQueue.shift();
        try {
            const cached = getCachedHtml(url);
            if (cached) {
                resolve(cached);
                resetFetchDelay();
            } else {
                const response = await fetch(url, {
                    credentials: 'include',
                    referrer: window.location.href,
                });
                if (!response.ok) {
                    if (response.status === 403 || response.status === 429) {
                        markFetchBlocked(`fetch_${response.status}`);
                        resolve(null);
                    } else {
                        reject(new Error(`fetch_${response.status}`));
                        applyFetchBackoff();
                    }
                } else {
                    const html = await response.text();
                    fetchCache.set(url, { html, ts: Date.now() });
                    resolve(html);
                    resetFetchDelay();
                }
            }
        } catch (error) {
            reject(error);
            applyFetchBackoff();
        }
        await new Promise(r => setTimeout(r, fetchDelayMs));
    }
    fetchActive = false;
}

function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
}

async function loadDetailsCache() {
    if (detailsCache) return detailsCache;
    const result = await chrome.storage.local.get([DETAILS_CACHE_KEY]);
    detailsCache = result[DETAILS_CACHE_KEY] || {};
    return detailsCache;
}

function trimDetailsCache(cache) {
    const entries = Object.entries(cache);
    if (entries.length <= DETAILS_CACHE_MAX) return;
    entries.sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
    const trimmed = entries.slice(0, DETAILS_CACHE_MAX);
    Object.keys(cache).forEach(key => delete cache[key]);
    trimmed.forEach(([key, value]) => {
        cache[key] = value;
    });
}

function updateDetailsCache(cache, uid, details) {
    if (!cache || !uid || !details) return;
    cache[uid] = {
        ...(cache[uid] || {}),
        ...details,
        ts: Date.now(),
    };
    trimDetailsCache(cache);
    scheduleDetailsCacheSave(cache);
}

function getCachedDetails(cache, uid) {
    if (!cache || !uid) return null;
    const entry = cache[uid];
    if (!entry) return null;
    if (Date.now() - (entry.ts || 0) > DETAILS_CACHE_TTL_MS) {
        delete cache[uid];
        return null;
    }
    return entry;
}

function scheduleDetailsCacheSave(cache) {
    if (detailsCacheSaveTimer) return;
    detailsCacheSaveTimer = setTimeout(() => {
        chrome.storage.local.set({ [DETAILS_CACHE_KEY]: cache || {} });
        detailsCacheSaveTimer = null;
    }, 1000);
}

function loadEvalCache() {
    try {
        const raw = window.localStorage.getItem(EVAL_CACHE_KEY);
        const cache = raw ? JSON.parse(raw) : {};
        return pruneEvalCache(cache);
    } catch (error) {
        return {};
    }
}

function saveEvalCache(cache) {
    try {
        window.localStorage.setItem(EVAL_CACHE_KEY, JSON.stringify(cache || {}));
    } catch (error) {
        // Ignore storage errors.
    }
}

function pruneEvalCache(cache) {
    if (!cache) return {};
    const now = Date.now();
    let changed = false;
    Object.keys(cache).forEach(key => {
        const entry = cache[key];
        if (!entry || now - (entry.ts || 0) > EVAL_CACHE_TTL_MS) {
            delete cache[key];
            changed = true;
        }
    });
    const entries = Object.entries(cache);
    if (entries.length > EVAL_CACHE_MAX) {
        entries.sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0));
        const trimmed = entries.slice(0, EVAL_CACHE_MAX);
        Object.keys(cache).forEach(key => delete cache[key]);
        trimmed.forEach(([key, value]) => {
            cache[key] = value;
        });
        changed = true;
    }
    if (changed) saveEvalCache(cache);
    return cache;
}

function getEvalCacheKey(link, card) {
    const url = link?.href || '';
    return extractJobUidFromUrl(url)
        || card?.getAttribute('data-ev-job-uid')
        || url;
}

function getCachedEvaluation(cache, key) {
    if (!cache || !key) return null;
    const entry = cache[key];
    if (!entry) return null;
    if (Date.now() - (entry.ts || 0) > EVAL_CACHE_TTL_MS) {
        delete cache[key];
        saveEvalCache(cache);
        return null;
    }
    return entry;
}

function setCachedEvaluation(cache, key, entry) {
    if (!cache || !key || !entry) return;
    cache[key] = { ...entry, ts: Date.now() };
    pruneEvalCache(cache);
    saveEvalCache(cache);
}

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

const countryAliases = {
    'united states of america': 'united states',
    'usa': 'united states',
    'uk': 'united kingdom',
    'czechia': 'czech republic',
    'eswatini': 'swaziland',
};

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

function normalizeCountryName(value) {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    return countryAliases[normalized] || normalized;
}

function toNumber(value, fallback) {
    const num = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(num) ? num : fallback;
}

function getText(root, selectors) {
    for (const selector of selectors) {
        const el = root?.querySelector(selector);
        if (el && el.textContent) {
            return el.textContent.trim();
        }
    }
    return null;
}

function extractJobUidFromUrl(url) {
    if (!url) return null;
    const match = url.match(/~([0-9a-zA-Z]+)/);
    return match ? match[1] : null;
}

function createDetailNode(text) {
    if (!text) return null;
    const node = document.createElement('div');
    node.textContent = text;
    node.style.marginRight = '5px';
    node.classList.add('text-dark', 'display-inline-block', 'md');
    return node;
}

function extractHireRateText(card, doc) {
    const selectors = [
        'li[data-qa="client-job-posting-stats"]',
        'li[data-test="client-job-posting-stats"]',
        '[data-qa="client-job-posting-stats"]',
        '[data-test="client-job-posting-stats"]',
        '[data-test="job-activity"]',
        '[data-test="job-activity-summary"]',
        '[data-test="job-activity-data"]',
    ];
    let source = null;
    for (const selector of selectors) {
        source = card?.querySelector(selector) || doc?.querySelector(selector);
        if (source) break;
    }
    if (source) {
        const inner = source.querySelector('div') || source;
        const text = inner?.innerText?.trim() || source?.innerText?.trim();
        if (text) return text;
    }

    const textSource = card?.innerText || doc?.body?.innerText || '';
    if (!textSource) return null;
    const hireMatch = textSource.match(/(\d{1,3})%\s*hire rate/i);
    const openMatch = textSource.match(/(\d+)\s*open jobs?/i);
    if (!hireMatch && !openMatch) return null;
    const parts = [];
    if (hireMatch) parts.push(`${hireMatch[1]}% hire rate`);
    if (openMatch) parts.push(`${openMatch[1]} open jobs`);
    return parts.join(', ');
}

function extractConnectsText(doc) {
    if (!doc) return null;
    const divs = doc.querySelectorAll('div');
    for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        const directText = Array.from(div.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .join('');
        if (directText === 'Send a proposal for:') {
            const strongElement = div.querySelector('strong');
            if (strongElement) {
                let text = strongElement.textContent.trim();
                if (text) {
                    if (!/connect/i.test(text)) text = `${text} Connects`;
                    if (!/required/i.test(text)) text = `${text} Required`;
                    return text;
                }
            }
        }
    }
    const fallback = doc.body?.innerText || '';
    const match = fallback.match(/(\d+)\s*connects?/i);
    if (match) return `${match[1]} Connects Required`;
    return null;
}

function extractMemberSinceText(doc) {
    if (!doc) return null;
    const memberSince = doc.querySelector('li[data-qa="client-contract-date"] > small')
        || doc.querySelector('li[data-test="client-contract-date"] > small')
        || doc.querySelector('[data-qa="client-contract-date"]')
        || doc.querySelector('[data-test="client-contract-date"]');
    const text = memberSince?.textContent?.trim();
    return text || null;
}

function getCountryFromText(text) {
    if (!text) return null;
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1] || text;
    const parts = lastLine.split(',').map(part => part.trim()).filter(Boolean);
    return parts[parts.length - 1] || null;
}

function scoreProposals(value) {
    if (!value) return null;
    const mapping = {
        'less than 5': 10,
        '5 to 10': 9,
        '10 to 15': 8,
        '15 to 20': 7,
        '20 to 50': 5,
        '50+': 2,
    };
    return mapping[value.toLowerCase().trim()] ?? null;
}

function scoreExperience(value) {
    if (!value) return null;
    const mapping = {
        'expert': 10,
        'intermediate': 7.5,
        'entry level': 5,
    };
    return mapping[value.toLowerCase().trim()] ?? null;
}

function scoreBudget(value, settings) {
    if (!value) return null;
    const match = value.match(/\$?([\d,]+(?:\.\d{2})?)/);
    if (!match) return null;
    const amount = parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount < 0) return null;
    const target = toNumber(settings.budgetTarget, defaultScoreSettings.budgetTarget);
    if (target <= 0) return null;
    return Math.min(10, (amount / target) * 10);
}

function parseHireRate(value) {
    if (!value) return null;
    const match = String(value).match(/(\d{1,3})%\s*hire rate/i);
    if (!match) return null;
    const percent = parseInt(match[1], 10);
    if (!Number.isFinite(percent)) return null;
    return Math.max(0, Math.min(100, percent));
}

function scoreHireRate(value, settings) {
    const rate = typeof value === 'number' ? value : parseHireRate(value);
    if (rate === null || rate === undefined) return null;
    const minRate = toNumber(settings.hireRateMin, defaultScoreSettings.hireRateMin);
    const targetRate = toNumber(settings.hireRateTarget, defaultScoreSettings.hireRateTarget);
    const low = Math.max(0, Math.min(minRate, 100));
    const high = Math.max(low + 1, Math.min(targetRate, 100));
    if (rate <= low) return 0;
    if (rate >= high) return 10;
    return ((rate - low) / (high - low)) * 10;
}

function scoreTime(value) {
    if (!value) return null;
    const lower = value.toLowerCase().trim();
    let durationScore = 0;
    let hoursScore = 0;

    if (lower.includes('less than 1 month')) durationScore = 0;
    else if (lower.includes('1 to 3 months')) durationScore = 1;
    else if (lower.includes('3 to 6 months')) durationScore = 2;
    else if (lower.includes('more than 6 months')) durationScore = 3;

    if (lower.includes('less than 30 hrs/week')) hoursScore = 1;
    else if (lower.includes('30+ hrs/week')) hoursScore = 2;
    else if (lower.includes('not sure') || lower.includes('hours to be determined')) hoursScore = 0;

    const score = ((durationScore + hoursScore) / 7) * 10;
    return Math.min(10, Math.max(0, score));
}

function scorePaymentStatus(value) {
    if (!value) return null;
    return value.includes('Payment verified') ? 10 : -10;
}

function scoreClientPaid(value, settings) {
    if (!value) return null;
    let cleaned = value.replace(/[+$]/g, '').toLowerCase();
    let amount = parseFloat(cleaned);
    if (cleaned.includes('k')) amount *= 1000;
    if (cleaned.includes('m')) amount *= 1000000;
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return -5;
    const target = toNumber(settings.clientPaidTarget, defaultScoreSettings.clientPaidTarget);
    if (target <= 0) return null;
    return Math.min(10, (amount / target) * 10);
}

function scoreClientRating(value, settings) {
    if (!value) return null;
    const rating = parseFloat(value);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) return null;
    const target = toNumber(settings.clientRatingTarget, defaultScoreSettings.clientRatingTarget);
    if (target <= 0) return null;
    return Math.min(10, (rating / target) * 10);
}

function scorePostingTime(value) {
    if (!value) return null;
    const presets = {
        'yesterday': 2,
        'last week': 0,
        '2 weeks ago': 0,
        'last month': 0,
        '2 months ago': 0,
        'last quarter': 0,
        '2 quarters ago': 0,
        '3 quarters ago': 0,
        'last year': 0,
        '2 years ago': 0,
    };
    const lower = value.toLowerCase().trim();
    if (Object.prototype.hasOwnProperty.call(presets, lower)) {
        return presets[lower];
    }

    const match = lower.match(/(\d+)\s*(second|minute|hour|day|month|year)s?\s*ago/);
    if (!match) return null;

    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const seconds = amount * ({
        second: 1,
        minute: 60,
        hour: 3600,
        day: 86400,
        month: 2592000,
        year: 31536000,
    }[unit] || 0);

    if (seconds < 900) return 10;
    if (seconds < 1800) return 9;
    if (seconds < 3600) return 8;
    if (seconds < 7200) return 7;
    if (seconds < 14400) return 6;
    if (seconds < 21600) return 5;
    if (seconds < 43200) return 4;
    if (seconds < 86400) return 3;
    return 0;
}

function scoreFeatured(root) {
    return root?.querySelector('[data-test="featured-badge"]') ? 10 : null;
}

function scoreCountry(value, settings) {
    if (!value) return null;
    const normalized = normalizeCountryName(value);
    const preferredSet = new Set(
        (settings.preferredCountries || []).map(item => normalizeCountryName(item))
    );

    return preferredSet.has(normalized)
        ? toNumber(settings.countryPreferredScore, defaultScoreSettings.countryPreferredScore)
        : toNumber(settings.countryOtherScore, defaultScoreSettings.countryOtherScore);
}

function calculateScore(card, doc, settings, details) {
    const getValue = selectors => getText(card, selectors) || getText(doc, selectors);

    const hireRateText = details?.hireRateText || extractHireRateText(card, doc);
    const hireRate = scoreHireRate(hireRateText, settings);
    const proposals = scoreProposals(getValue([
        'strong[data-test="proposals"]',
        '[data-test="proposals-tier"] > strong',
    ]));
    const experience = scoreExperience(getValue([
        'span[data-test="contractor-tier"]',
        '[data-test="experience-level"] > strong',
    ]));
    const budget = scoreBudget(getValue([
        '[data-test="budget"]',
        '[data-test="is-fixed-price"] > strong:nth-of-type(2)',
    ]), settings);
    const time = scoreTime(getValue([
        '[data-test="duration"]',
        '[data-test="duration-label"] > strong:nth-of-type(2)',
    ]));
    const paymentVerified = scorePaymentStatus(getValue([
        '[data-test="payment-verification-status"] > strong',
        '[data-test="payment-verified"]',
    ]));
    const clientPaid = scoreClientPaid(getValue([
        '[data-test="client-spendings"] > strong',
        '[data-test="total-spent"]',
    ]), settings);
    const clientRating = scoreClientRating((getValue([
        "[data-test='js-feedback']",
        "[data-test='total-feedback']",
    ]) || '')
        .replace('Rating is', '')
        .replace('out of 5.', '')
        .trim(), settings);
    const postingTime = scorePostingTime((getValue([
        '[data-test="posted-on"]',
        '[data-test="job-pubilshed-date"]',
    ]) || '').replace(/^Posted\s*/i, ''));
    const featured = scoreFeatured(card) ?? scoreFeatured(doc);

    const countryText = getCountryFromText(getValue([
        '[data-test="client-country"]',
        '[data-test="location"]',
    ]));
    const clientCountry = scoreCountry(countryText, settings);

    const scored = [
        { value: hireRate, weight: settings.weights.hireRate },
        { value: proposals, weight: settings.weights.proposals },
        { value: experience, weight: settings.weights.experience },
        { value: budget, weight: settings.weights.budget },
        { value: time, weight: settings.weights.time },
        { value: paymentVerified, weight: settings.weights.paymentVerified },
        { value: clientPaid, weight: settings.weights.clientPaid },
        { value: clientRating, weight: settings.weights.clientRating },
        { value: postingTime, weight: settings.weights.postingTime },
        { value: featured, weight: settings.weights.featured },
        { value: clientCountry, weight: settings.weights.clientCountry },
    ];

    let total = 0;
    let weightSum = 0;
    scored.forEach(({ value, weight }) => {
        if (value === null || value === undefined) return;
        const numericWeight = toNumber(weight, 0);
        if (numericWeight <= 0) return;
        total += value * numericWeight;
        weightSum += numericWeight;
    });

    if (weightSum === 0) return null;
    return total / weightSum;
}

function getScoreClass(score) {
    if (score >= 7) return 'badge-green';
    if (score >= 5) return 'badge-light-green';
    if (score >= 3) return 'badge-yellow';
    return 'badge-red';
}

function getRowClass(score) {
    if (score >= 7) return 'smartjob-row-green';
    if (score >= 5) return 'smartjob-row-light-green';
    if (score >= 3) return 'smartjob-row-yellow';
    return 'smartjob-row-red';
}

function getHireRateNode(card, doc) {
    const text = extractHireRateText(card, doc);
    return createDetailNode(text);
}

function applyRowHighlight(card, score) {
    const row = card?.querySelector('.smartjob-enhancement');
    if (!row) return;
    row.classList.remove(
        'smartjob-row-green',
        'smartjob-row-light-green',
        'smartjob-row-yellow',
        'smartjob-row-red'
    );
    if (score === null || score === undefined) return;
    row.classList.add(getRowClass(score));
}

function renderScoreBadge(card, score) {
    if (!card || score === null || score === undefined) return;
    const enhancementRow = card.querySelector('.smartjob-enhancement');
    const actions = card.querySelector('[class="job-tile-actions"], [data-test="JobTileActions"]');
    const container = enhancementRow || actions || card;
    let wrapper = container.querySelector('.UpworkJobScore');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'UpworkJobScore';
        container.insertBefore(wrapper, container.firstChild);
    }

    let label = wrapper.querySelector('h3');
    if (!label) {
        label = document.createElement('h3');
        wrapper.appendChild(label);
    }

    label.className = getScoreClass(score);
    label.textContent = score.toFixed(1);
    applyRowHighlight(card, score);
}

function placeEnhancement(card, link, element) {
    const titleContainer = link?.closest('[data-test="job-tile-title"], .job-tile-title, h4, h3, h2');
    if (titleContainer?.parentNode) {
        titleContainer.insertAdjacentElement('afterend', element);
        return true;
    }

    const fallback = card.querySelector('[data-test="JobTileBody"], [data-test="JobTileHeader"]') || card;
    if (!fallback) return false;
    fallback.insertBefore(element, fallback.firstChild);
    return true;
}

function ensureEnhancementRow(card, link, enhancementId) {
    let row = card.querySelector(`#${enhancementId}`);
    if (row) return row;
    row = document.createElement('div');
    row.id = enhancementId;
    row.style.display = 'flex';
    row.style.marginTop = '10px';
    row.classList.add('smartjob-enhancement');
    placeEnhancement(card, link, row);
    return row;
}

function ensureDetailsContainer(row) {
    let container = row.querySelector('.smartjob-details');
    if (container) return container;
    container = document.createElement('div');
    container.className = 'smartjob-details';
    row.appendChild(container);
    return container;
}

function ensureDetailsLoader(container) {
    let loader = container.querySelector('.smartjob-loader');
    if (loader) return loader;
    loader = document.createElement('div');
    loader.className = 'smartjob-loader';
    const spinner = document.createElement('span');
    spinner.className = 'smartjob-spinner';
    const text = document.createElement('span');
    text.className = 'smartjob-loader-text';
    text.textContent = 'Підтягуємо дані...';
    loader.appendChild(spinner);
    loader.appendChild(text);
    container.appendChild(loader);
    return loader;
}

function clearDetailsLoader(container) {
    const loader = container.querySelector('.smartjob-loader');
    if (loader) loader.remove();
}

function setDetailsStatus(container, message) {
    let status = container.querySelector('.smartjob-status');
    if (!message) {
        if (status) status.remove();
        return;
    }
    if (!status) {
        status = document.createElement('div');
        status.className = 'smartjob-status';
        container.appendChild(status);
    }
    status.textContent = message;
}

function parseVerdict(text) {
    if (!text) return 'Немає відповіді';
    if (/не\s*варто/i.test(text)) return 'НЕ ВАРТО';
    if (/варто/i.test(text)) return 'ВАРТО';
    const firstLine = text.split('\n').map(line => line.trim()).find(Boolean);
    return firstLine || text.trim();
}

function extractJobInfoFromPage(card) {
    const title = getText(card, ['[data-test="job-tile-title"]', '.job-tile-title', 'a']) ||
        getText(document, ['[data-test="job-title"]', 'h1', '.job-title']) ||
        'Без назви';
    const descriptionSelectors = [
        '[data-test="job-description-text"]',
        '[data-test="job-tile-description"]',
        '[data-test="job-description"]',
        '[data-test="JobDescription"]',
        '.job-description',
        '.job-tile-description',
    ];
    let description = getText(card, descriptionSelectors) || '';
    if (!description) {
        description = getText(document, ['[data-test="job-description-text"]']) || '';
    }
    if (!description && card) {
        const clone = card.cloneNode(true);
        clone.querySelectorAll('.smartjob-enhancement, .smartjob-evaluate, .UpworkJobScore').forEach(el => el.remove());
        description = clone.innerText.trim();
    }
    const skills = Array.from((card || document).querySelectorAll('[data-test="skill-tag"]'))
        .map(el => el.textContent.trim())
        .filter(Boolean)
        .join(', ');

    return { title, description, skills };
}

async function requestLlmVerdict(payload) {
    const response = await chrome.runtime.sendMessage({
        type: 'smartjob:evaluate',
        payload,
    });
    return response;
}

function setEvaluateResult(resultEl, message, tone) {
    resultEl.textContent = message;
    resultEl.classList.remove('good', 'bad');
    if (tone === 'good') resultEl.classList.add('good');
    if (tone === 'bad') resultEl.classList.add('bad');
}

function ensureEvaluateControl(card, link, hostElement) {
    const existing = card.querySelector('.smartjob-evaluate');
    if (existing) return existing;

    const evalCache = loadEvalCache();
    const evalKey = getEvalCacheKey(link, card);
    const cachedEval = getCachedEvaluation(evalCache, evalKey);

    const wrapper = document.createElement('div');
    wrapper.className = 'smartjob-evaluate';
    wrapper.setAttribute('data-smartjob-control', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'smartjob-evaluate-btn';
    button.textContent = cachedEval ? 'Оцінено' : 'Оцінити';
    const result = document.createElement('span');
    result.className = 'smartjob-evaluate-result';

    wrapper.appendChild(button);
    wrapper.appendChild(result);

    if (cachedEval) {
        const cachedContent = cachedEval.content || '';
        const cachedVerdict = cachedEval.verdict || parseVerdict(cachedContent);
        if (cachedVerdict) {
            setEvaluateResult(result, cachedVerdict,
                cachedVerdict === 'ВАРТО' ? 'good' : (cachedVerdict === 'НЕ ВАРТО' ? 'bad' : undefined));
        }
    }

    const stopEvent = event => {
        event.preventDefault();
        event.stopPropagation();
    };

    wrapper.addEventListener('click', stopEvent);
    wrapper.addEventListener('mousedown', stopEvent);
    wrapper.addEventListener('pointerdown', stopEvent);
    wrapper.addEventListener('touchstart', stopEvent);

    if (hostElement) {
        hostElement.appendChild(wrapper);
    } else {
        placeEnhancement(card, link, wrapper);
    }

    button.addEventListener('pointerdown', stopEvent);
    button.addEventListener('click', async event => {
        stopEvent(event);
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = 'Оцінюю...';
        setEvaluateResult(result, '');
        let evaluationOk = false;
        try {
            const info = extractJobInfoFromPage(card);
            if (!info.description) {
                throw new Error('Відкрийте деталі вакансії, щоб отримати опис');
            }

            const llmResponse = await requestLlmVerdict({
                title: info.title,
                description: info.description,
                skills: info.skills,
                url: link.href,
            });

            if (!llmResponse?.ok) {
                if (llmResponse?.error === 'missing_api_key') {
                    setEvaluateResult(result, 'Додайте ключ OpenRouter у налаштуваннях');
                } else if (llmResponse?.error === 'data_policy') {
                    const details = llmResponse?.details || 'Обмеження політики даних OpenRouter';
                    setEvaluateResult(result, `${details}. Privacy: https://openrouter.ai/settings/privacy`);
                } else {
                    setEvaluateResult(result, llmResponse?.details || llmResponse?.error || 'Помилка оцінки');
                }
                return;
            }

            const content = llmResponse.content || '';
            if (!content.trim()) {
                setEvaluateResult(result, 'Порожня відповідь від моделі');
                return;
            }
            const verdict = parseVerdict(content);
            if (verdict === 'ВАРТО') {
                setEvaluateResult(result, verdict, 'good');
            } else if (verdict === 'НЕ ВАРТО') {
                setEvaluateResult(result, verdict, 'bad');
            } else {
                setEvaluateResult(result, verdict);
            }
            setCachedEvaluation(evalCache, evalKey, { verdict, content });
            evaluationOk = true;
        } catch (error) {
            setEvaluateResult(result, error?.message || 'Не вдалося');
        } finally {
            button.disabled = false;
            button.textContent = evaluationOk ? 'Оцінено' : 'Оцінити';
        }
    });

    return wrapper;
}

function waitForLinks(timeout = 15000) {
    return new Promise((resolve, reject) => {
        const interval = 100; // Check every 100ms
        const start = Date.now();

        const checkLinks = () => {
            const links = document.querySelectorAll('a[href^="/jobs/"]');
            if (links.length > 2) {
                resolve(links);
            } else if (Date.now() - start >= timeout) {
                reject(new Error("Timeout exceeded"));
            } else {
                setTimeout(checkLinks, interval);
            }
        };

        checkLinks();
    });
}

async function captureJobDetailsFromPage() {
    const uid = extractJobUidFromUrl(window.location.href)
        || document.querySelector('[data-ev-job-uid]')?.getAttribute('data-ev-job-uid');
    if (!uid) return;
    const hireRateText = extractHireRateText(null, document);
    const connectsText = extractConnectsText(document);
    const memberSinceText = extractMemberSinceText(document);
    if (!hireRateText && !connectsText && !memberSinceText) return;
    const cache = await loadDetailsCache();
    updateDetailsCache(cache, uid, {
        ...(hireRateText ? { hireRateText } : {}),
        ...(connectsText ? { connectsText } : {}),
        ...(memberSinceText ? { memberSinceText } : {}),
    });
}

async function upwork() {
    console.log("Script executed on Upwork.com");

    const result = await chrome.storage.local.get(['checkboxes', 'scoreSettings', DETAILS_CACHE_KEY]);
    const _checkboxes = result.checkboxes || checkboxes;
    const scoreSettings = mergeScoreSettings(result.scoreSettings);
    const { checkboxHireRate, checkboxConnectsRequired, checkboxMemberSince, checkboxAutoLoad } = _checkboxes;
    const autoLoad = checkboxes['checkboxAutoLoad'];
    detailsCache = result[DETAILS_CACHE_KEY] || detailsCache || {};

    if (checkboxAutoLoad === false || (checkboxAutoLoad === undefined && !autoLoad)) {
        return;
    }

    if (
        checkboxHireRate === false
        && checkboxConnectsRequired === false
        && checkboxMemberSince === false
        && scoreSettings.enabled === false
    ) {
        return;
    }

    let fetchRunCount = 0;
    var links = await waitForLinks();
    for (var l = 0; l < links.length && links.length > 0; l++) {
        var a = links[l];
        const refNode = a.closest('section.air3-card-section, article.job-tile') || a.parentNode.parentNode.parentNode;
        const enhancementId = `upworkSearchEnhancement${l + 1}`;
        const shouldFetchDetails = checkboxHireRate || checkboxConnectsRequired || checkboxMemberSince;
        const enhancementRow = ensureEnhancementRow(refNode, a, enhancementId);
        const detailsContainer = ensureDetailsContainer(enhancementRow);
        const detailsLoaded = detailsContainer.dataset.smartjobLoaded === 'true';
        const isVisible = isElementVisible(refNode);
        ensureEvaluateControl(refNode, a, enhancementRow);

        // Check if an element with the same id already exists
        let doc = null;
        let cachedDetails = null;
        const jobUid = extractJobUidFromUrl(a.href);
        cachedDetails = getCachedDetails(detailsCache, jobUid);
        if (shouldFetchDetails && !detailsLoaded) {
            const newNodes = [];
            let hasContent = false;
            const wantsHireRate = checkboxHireRate === true || (checkboxHireRate !== false && checkboxes['checkboxHireRate']);
            const wantsConnects = checkboxConnectsRequired === true || (checkboxConnectsRequired !== false && checkboxes['checkboxConnectsRequired']);
            const wantsMemberSince = checkboxMemberSince === true || (checkboxMemberSince !== false && checkboxes['checkboxMemberSince']);
            const hasCachedDetails = Boolean(cachedDetails);

            let hireRateText = null;
            let connectsText = null;
            let memberSinceText = null;

            if (wantsHireRate) {
                const stats = getHireRateNode(refNode, null);
                if (stats) {
                    hireRateText = stats.textContent;
                    newNodes.push(stats);
                    hasContent = true;
                } else if (cachedDetails?.hireRateText) {
                    hireRateText = cachedDetails.hireRateText;
                    const cachedNode = createDetailNode(hireRateText);
                    if (cachedNode) {
                        newNodes.push(cachedNode);
                        hasContent = true;
                    }
                }
            }

            if (wantsConnects && cachedDetails?.connectsText) {
                connectsText = cachedDetails.connectsText;
                const cachedNode = createDetailNode(connectsText);
                if (cachedNode) {
                    newNodes.push(cachedNode);
                    hasContent = true;
                }
            }

            if (wantsMemberSince && cachedDetails?.memberSinceText) {
                memberSinceText = cachedDetails.memberSinceText;
                const cachedNode = createDetailNode(memberSinceText);
                if (cachedNode) {
                    newNodes.push(cachedNode);
                    hasContent = true;
                }
            }

            let needsFetch = (wantsHireRate && !hireRateText)
                || (wantsConnects && !connectsText)
                || (wantsMemberSince && !memberSinceText);
            if (hasCachedDetails) {
                needsFetch = false;
            }

            if (needsFetch && !hasContent) {
                if (isFetchBlocked()) {
                    clearDetailsLoader(detailsContainer);
                    setDetailsStatus(detailsContainer, 'Відкрийте вакансію, щоб підтягнути деталі');
                } else {
                    setDetailsStatus(detailsContainer, '');
                    ensureDetailsLoader(detailsContainer);
                }
            }

            try {
                const canFetch = needsFetch
                    && isVisible
                    && fetchRunCount < FETCH_MAX_PER_RUN
                    && !isFetchBlocked();
                if (canFetch) {
                    fetchRunCount += 1;
                    const html = await enqueueFetch(a.href);
                    if (!html) {
                        clearDetailsLoader(detailsContainer);
                        setDetailsStatus(detailsContainer, 'Відкрийте вакансію, щоб підтягнути деталі');
                        continue;
                    }
                    const parser = new DOMParser();
                    doc = parser.parseFromString(html, 'text/html');

                    if (wantsHireRate && !hireRateText) {
                        const text = extractHireRateText(null, doc);
                        if (text) {
                            hireRateText = text;
                            const node = createDetailNode(text);
                            if (node) {
                                newNodes.push(node);
                                hasContent = true;
                            }
                        }
                    }

                    if (wantsConnects && !connectsText) {
                        const text = extractConnectsText(doc);
                        if (text) {
                            connectsText = text;
                            const node = createDetailNode(text);
                            if (node) {
                                newNodes.push(node);
                                hasContent = true;
                            }
                        }
                    }

                    if (wantsMemberSince && !memberSinceText) {
                        const text = extractMemberSinceText(doc);
                        if (text) {
                            memberSinceText = text;
                            const node = createDetailNode(text);
                            if (node) {
                                newNodes.push(node);
                                hasContent = true;
                            }
                        }
                    }

                    if (jobUid && (hireRateText || connectsText || memberSinceText)) {
                        updateDetailsCache(detailsCache, jobUid, {
                            ...(hireRateText ? { hireRateText } : {}),
                            ...(connectsText ? { connectsText } : {}),
                            ...(memberSinceText ? { memberSinceText } : {}),
                        });
                    }
                }
            } catch (error) {
                console.error('Failed to fetch HTML:', error);
            }

            if (hasContent) {
                clearDetailsLoader(detailsContainer);
                setDetailsStatus(detailsContainer, '');
                detailsContainer.innerHTML = '';
                newNodes.forEach(node => detailsContainer.appendChild(node));
                detailsContainer.dataset.smartjobLoaded = 'true';
            }
        } else {
            clearDetailsLoader(detailsContainer);
            setDetailsStatus(detailsContainer, '');
        }

        if (scoreSettings.enabled) {
            const score = calculateScore(refNode, doc, scoreSettings, cachedDetails);
            renderScoreBadge(refNode, score);
        }
    }
}

let upworkRunning = false;
let upworkQueued = false;
let upworkScrollTimer = null;

async function runUpwork() {
    if (upworkRunning) {
        upworkQueued = true;
        return;
    }
    upworkRunning = true;
    try {
        await captureJobDetailsFromPage();
        await upwork();
    } finally {
        upworkRunning = false;
        if (upworkQueued) {
            upworkQueued = false;
            runUpwork();
        }
    }
}

function scheduleUpwork() {
    if (upworkScrollTimer) clearTimeout(upworkScrollTimer);
    upworkScrollTimer = setTimeout(() => {
        runUpwork();
    }, SCROLL_DEBOUNCE_MS);
}

var oldUrl = window.location.href;
function listen(currentUrl) {
    if (currentUrl != oldUrl) {
        setTimeout(runUpwork, 2000);
        setTimeout(captureJobDetailsFromPage, 1500);
    }

    oldUrl = window.location.href;
    setTimeout(function () {
        listen(window.location.href);
    }, 1000);
}

window.onload = () => {
    runUpwork();
    listen(window.location.href);
    window.addEventListener('scroll', scheduleUpwork, { passive: true });
    window.addEventListener('resize', scheduleUpwork);
};
