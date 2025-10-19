
// background.js

// Handle extension installation - trigger setup on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // First-time installation - check if setup is needed
    const { setupCompleted } = await chrome.storage.sync.get('setupCompleted');
    
    if (!setupCompleted) {
      // Open setup page in new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    }
  } else if (details.reason === 'update') {
    // Extension updated - verify setup integrity
    const { setupCompleted, totpSecret } = await chrome.storage.sync.get(['setupCompleted', 'totpSecret']);
    
    // If setup was marked complete but secret is missing, it's corrupted
    if (setupCompleted && !totpSecret) {
      console.warn('Setup data corrupted - resetting setup state');
      await chrome.storage.sync.set({ setupCompleted: false });
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Ignore navigations happening in subframes.
    if (details.frameId !== 0) {
      return;
    }

    const url = new URL(details.url);

    // 1. Check if the site is temporarily allowed.
    const { tempAllowedSites = {} } = await chrome.storage.local.get('tempAllowedSites');
    const sitePermission = tempAllowedSites[url.hostname];

    if (sitePermission && sitePermission > Date.now()) {
      return; // Permission is valid, so do nothing and allow navigation.
    }

    // 2. If not temporarily allowed, check if it's on the main blocklist.
    const { blockedSites = [] } = await chrome.storage.sync.get('blockedSites');
    if (blockedSites.length === 0) {
      return; // No sites to block, exit early.
    }

    const isBlocked = blockedSites.some(site => {
      const hostname = url.hostname;
      return hostname === site || hostname.endsWith('.' + site);
    });

    if (isBlocked) {
      // 3. If it is blocked, redirect to blocked.html and PASS THE DOMAIN as a URL parameter.
      const blockedPageUrl = chrome.runtime.getURL(`blocked.html?site=${url.hostname}`);

      chrome.tabs.update(details.tabId, { url: blockedPageUrl });
    }
  }, { url: [{ schemes: ["http", "https"] }] });

// Handle messages from options page and setup page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateRules') {
    // Rules are automatically updated when storage changes
    // This is just for compatibility with options page
    sendResponse({ success: true });
  } else if (request.action === 'setupComplete') {
    // Setup completion notification (storage is already updated by setup.js)
    console.log('Setup completed successfully');
    sendResponse({ success: true });
  }
});
