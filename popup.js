/* popup.js */
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveKeyBtn');
  const statusEl = document.getElementById('statusMessage');

  // Load existing key
  chrome.storage.local.get(['apiKey'], (result) => {
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
  });

  // Save new key
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    chrome.storage.local.set({ apiKey: key }, () => {
      showStatus('API Key saved successfully!', 'success');
    });
  });

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 3000);
  }
});
