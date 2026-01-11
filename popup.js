// import { centrisScript } from './centris.js';
import { checkboxes } from './constants.js';
import { upwork } from './upworkModule.js';

// document.getElementById('btnCentris').addEventListener('click', () => {
//   chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
//     var activeTab = tabs[0];
//     chrome.scripting.executeScript({
//       target: { tabId: activeTab.id },
//       function: centrisScript
//     });
//   });
// });

document.getElementById('btnUpwork').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var activeTab = tabs[0];
    const url = activeTab?.url || '';
    if (!/^https:\/\/[^/]*upwork\.com\//.test(url)) {
      alert('Відкрийте сторінку Upwork перед запуском.');
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      function: upwork,
    });
    window.close();
  });
});

const settingsButton = document.getElementById('openSettings');
if (settingsButton) {
  settingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

Object.keys(checkboxes).forEach(async key => {
  const result = await chrome.storage.local.get(['checkboxes']);
  const _checkboxes = result.checkboxes || checkboxes;
  const htmlElement = document.getElementsByName(key)[0];

  if (key === 'checkboxAutoLoad' && htmlElement.checked !== _checkboxes[key]) {
    const { checkboxAutoLoad } = _checkboxes;
    const autoLoad = checkboxes['checkboxAutoLoad'];
    await toggleAutoLoad(checkboxAutoLoad === true || (checkboxAutoLoad !== false && autoLoad));
  }

  htmlElement.addEventListener('change', async (e) => {
    var name = e.target.getAttribute('name');
    const result = await chrome.storage.local.get(['checkboxes']);
    _checkboxes[name] = e.target.checked;
    await chrome.storage.local.set({ 'checkboxes': _checkboxes });
    await toggleAutoLoad(e.target.checked);
  });

  htmlElement.checked = _checkboxes[key];
});

async function toggleAutoLoad(checked) {
  if (checked) {
    try {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      const scriptIds = scripts.map(script => script.id);
      if (scriptIds.includes("upworkScript")) {
        await chrome.scripting.unregisterContentScripts({ 'ids': ["upworkScript"] });
      }
    } catch (err) {
      console.log('Error in unregisterContentScripts');
    }
    await chrome.scripting.registerContentScripts([{
      id: "upworkScript",
      matches: ['https://*.upwork.com/*'],
      js: ['upworkScript.js']
    }]);
  } else {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    console.log(scripts);
    const scriptIds = scripts.map(script => script.id);
    if (scriptIds.includes("upworkScript")) {
      await chrome.scripting.unregisterContentScripts({ 'ids': ["upworkScript"] });
    }
  }
}
