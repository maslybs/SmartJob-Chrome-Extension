chrome.runtime.onInstalled.addListener(async details => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        chrome.runtime.setUninstallURL('https://www.upwork.com/nx/find-work/');
    }
});

chrome.action.onClicked.addListener(() => {
    chrome.runtime.openOptionsPage();
});

const defaultLlmSettings = {
    apiKey: '',
    model: 'z-ai/glm-4.5-air:free',
    prompt: 'Ти кар\'єрний асистент Full-stack розробника та технічного архітектора. Профіль: MVP, AI-інтеграції, швидке прототипування, прагматичні рішення без over-engineering. Стек: Next.js/React/TypeScript, Node.js/FastAPI, PostgreSQL/Supabase/Redis, n8n/Webhooks, OpenAI/Gemini/LangChain, Docker, Cloudflare, OAuth/Stripe, Electron/Tauri. Оціни завдання під мій профіль (веб/MVP/desktop), складність vs бюджет, вимоги до стека, ризики та чіткість ТЗ. Відповідь українською у форматі: "ВАРТО" або "НЕ ВАРТО" і завжди 2-4 конкретні причини. Якщо даних мало, все одно дай рішення і поясни припущення.',
};

const fallbackModels = [
    'meta-llama/llama-3.1-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
];

async function resolveLlmSettings(overrides) {
    const result = await chrome.storage.local.get(['llmSettings']);
    return {
        ...defaultLlmSettings,
        ...(result.llmSettings || {}),
        ...(overrides || {}),
    };
}

function isDataPolicyError(message) {
    if (!message) return false;
    return /data policy|no endpoints found/i.test(message);
}

function formatProviderDetails(status, data, message) {
    const code = data?.error?.code;
    const type = data?.error?.type;
    const provider = data?.error?.metadata?.provider_name
        || data?.error?.metadata?.provider
        || data?.error?.metadata?.provider_id;
    const parts = [];
    if (status) parts.push(`HTTP ${status}`);
    if (code) parts.push(`code=${code}`);
    if (type) parts.push(`type=${type}`);
    if (provider) parts.push(`provider=${provider}`);
    if (!parts.length) return message || 'Provider error';
    return `${message || 'Provider error'} (${parts.join(', ')})`;
}

async function requestOpenRouter(llmSettings, payload) {
    if (!llmSettings.apiKey) {
        return { ok: false, error: 'missing_api_key' };
    }

    const title = payload.title || '';
    const description = payload.description || '';
    const skills = payload.skills || '';
    const url = payload.url || '';
    const prompt = (llmSettings.prompt || defaultLlmSettings.prompt).trim();
    const model = (llmSettings.model || defaultLlmSettings.model).trim();

    const skillsLine = skills ? `Навички: ${skills}\n` : '';
    const baseBody = {
        messages: [
            { role: 'system', content: prompt },
            {
                role: 'user',
                content: `Заголовок: ${title}\nURL: ${url}\n${skillsLine}Опис:\n${description}`,
            },
        ],
        temperature: 0.2,
    };

    const hasFreeSuffix = /:free\s*$/i.test(model);
    const modelsToTry = [model, ...(!hasFreeSuffix ? fallbackModels : [])];
    let lastError = '';

    for (const candidate of modelsToTry) {
        const body = { ...baseBody, model: candidate };
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${llmSettings.apiKey}`,
                'HTTP-Referer': 'https://www.upwork.com',
                'X-Title': 'SmartJob',
            },
            body: JSON.stringify(body),
        });

        const rawText = await response.text();
        let data = null;
        try {
            data = JSON.parse(rawText);
        } catch (error) {
            data = null;
        }

        if (response.ok) {
            const content = data?.choices?.[0]?.message?.content?.trim() || '';
            return { ok: true, content };
        }

        const message = data?.error?.message || `request_failed_${response.status}`;
        const details = formatProviderDetails(response.status, data, message);
        lastError = message;
        if (isDataPolicyError(message)) {
            continue;
        }
        return { ok: false, error: message, details };
    }

    if (isDataPolicyError(lastError)) {
        return { ok: false, error: 'data_policy', details: lastError };
    }
    return { ok: false, error: lastError || 'request_failed', details: lastError };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['smartjob:evaluate', 'smartjob:test-model'].includes(message?.type)) {
        return false;
    }

    (async () => {
        const overrideSettings = message.type === 'smartjob:test-model'
            ? (message.settings || {})
            : null;
        const llmSettings = await resolveLlmSettings(overrideSettings);
        const payload = message.payload || {};
        const response = await requestOpenRouter(llmSettings, payload);
        sendResponse(response);
    })().catch(error => {
        sendResponse({ ok: false, error: error?.message || 'request_failed' });
    });

    return true;
});
