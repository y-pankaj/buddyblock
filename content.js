// content.js - Monitor unlock timer expiry and show countdown for blocked sites

(async () => {
  const hostname = window.location.hostname;
  
  // Get blocked sites list
  const { blockedSites = [] } = await chrome.storage.sync.get('blockedSites');
  
  // Check if current site is blocked
  const isBlocked = blockedSites.some(site => 
    hostname === site || hostname.endsWith('.' + site)
  );
  
  if (!isBlocked) {
    return; // Nothing to monitor
  }
  
  // Check if we have active access
  const { tempAllowedSites = {} } = await chrome.storage.local.get('tempAllowedSites');
  const expiry = tempAllowedSites[hostname];
  
  if (!expiry || expiry <= Date.now()) {
    // No valid access - redirect immediately
    window.location.href = chrome.runtime.getURL(`blocked.html?site=${hostname}`);
    return;
  }
  
  // Inject countdown timer overlay
  injectCountdownOverlay(expiry, hostname);
  
  // Poll every 5 seconds for expiry check (reduced from 60s for better responsiveness)
  setInterval(async () => {
    const { tempAllowedSites = {} } = await chrome.storage.local.get('tempAllowedSites');
    const currentExpiry = tempAllowedSites[hostname];
    
    if (!currentExpiry || currentExpiry <= Date.now()) {
      window.location.href = chrome.runtime.getURL(`blocked.html?site=${hostname}`);
    }
  }, 5000);
})();

function injectCountdownOverlay(expiry, hostname) {
  // Create compact overlay div
  const overlay = document.createElement('div');
  overlay.id = 'buddyblock-countdown';
  overlay.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(102, 126, 234, 0.95);
    color: white;
    padding: 6px 12px;
    border-radius: 20px;
    font-family: monospace;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 999999;
    cursor: pointer;
    transition: opacity 0.5s ease, transform 0.3s ease;
    user-select: none;
  `;
  
  overlay.innerHTML = `⏱️ <strong id="countdown-time">--:--</strong>`;
  overlay.title = 'Click to toggle visibility';
  
  document.body.appendChild(overlay);
  
  // Auto-fade after 5 seconds
  setTimeout(() => {
    overlay.style.opacity = '0.3';
  }, 5000);
  
  // Show on hover
  overlay.addEventListener('mouseenter', () => {
    overlay.style.opacity = '1';
    overlay.style.transform = 'scale(1.05)';
  });
  
  overlay.addEventListener('mouseleave', () => {
    const remaining = expiry - Date.now();
    // Don't fade if less than 5 minutes remaining (keep visible as warning)
    if (remaining >= 5 * 60 * 1000) {
      overlay.style.opacity = '0.3';
    }
    overlay.style.transform = 'scale(1)';
  });
  
  // Update countdown every second
  const timeElement = document.getElementById('countdown-time');
  
  const updateCountdown = () => {
    const remaining = expiry - Date.now();
    
    if (remaining <= 0) {
      timeElement.textContent = '00:00';
      overlay.style.background = 'rgba(245, 87, 108, 0.95)';
      setTimeout(() => {
        window.location.href = chrome.runtime.getURL(`blocked.html?site=${hostname}`);
      }, 500);
      return;
    }
    
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timeElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Warning: Change color and stay visible when < 5 minutes remaining
    if (remaining < 5 * 60 * 1000) {
      overlay.style.background = 'rgba(245, 87, 108, 0.95)';
      overlay.style.opacity = '1';  // Keep fully visible in warning mode
    }
  };
  
  // Initial update
  updateCountdown();
  
  // Update every second
  setInterval(updateCountdown, 1000);
}
