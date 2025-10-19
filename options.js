// Options page script with TOTP-based QR generation and protected reset

let blockedSites = [];
let hasGeneratedInitialQR = false;
let totpSecret = null;
let totpSetupUri = null;
let setupCompleted = false;

// Rate limiting for reset attempts
let resetAttempts = 0;
let resetCooldownUntil = 0;

// Site removal state
let siteToRemoveIndex = -1;
let siteToRemoveName = '';

// Check if setup is completed before allowing any actions
async function checkSetupStatus() {
    const result = await chrome.storage.sync.get(['setupCompleted', 'totpSecret']);
    setupCompleted = result.setupCompleted || false;
    totpSecret = result.totpSecret || null;
    
    // If setup not completed or data corrupted, redirect to setup
    if (!setupCompleted || !totpSecret) {
        window.location.href = chrome.runtime.getURL('setup.html');
        return false;
    }
    
    return true;
}

// Update UI based on setup status
function updateSetupUI() {
    const setupWarning = document.getElementById('setupWarning');
    const addSiteBtn = document.getElementById('addSiteBtn');
    const newSiteInput = document.getElementById('newSite');
    
    if (!setupCompleted) {
        // Show warning and disable adding sites
        if (setupWarning) {
            setupWarning.classList.remove('hidden');
        }
        addSiteBtn.disabled = true;
        newSiteInput.disabled = true;
        newSiteInput.placeholder = 'Complete setup first before adding sites';
    } else {
        // Hide warning and enable functionality
        if (setupWarning) {
            setupWarning.classList.add('hidden');
        }
        addSiteBtn.disabled = false;
        newSiteInput.disabled = false;
        newSiteInput.placeholder = 'Enter website domain';
    }
}

// Initialize the options page
document.addEventListener('DOMContentLoaded', async function() {
    // First check setup status
    const isSetupComplete = await checkSetupStatus();
    if (!isSetupComplete) {
        return; // Will redirect to setup page
    }
    
    loadSettings();
    loadBlockedSites();
    updateSetupUI();
    
    // Allow Enter key to add sites
    document.getElementById('newSite').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            addSite();
        }
    });
    
    // Allow Enter key for TOTP input
    document.getElementById('totpInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            verifyTOTPAndShowSetupQR();
        }
    });
    
    // Allow Enter key for reset TOTP input
    document.getElementById('resetTotpInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            verifyTOTPAndReset();
        }
    });

    // Add event listeners for all buttons to avoid CSP violations
    document.getElementById('addSiteBtn').addEventListener('click', addSite);
    document.getElementById('generateTOTPBtn').addEventListener('click', generateInitialTOTPSetup);
    document.getElementById('showSetupQRBtn').addEventListener('click', verifyTOTPAndShowSetupQR);
    document.getElementById('downloadQRBtn').addEventListener('click', downloadQR);
    document.getElementById('clearQRBtn').addEventListener('click', clearQR);
    document.getElementById('resetWithTOTPBtn').addEventListener('click', verifyTOTPAndReset);
    document.getElementById('resetWithoutTOTPBtn').addEventListener('click', resetAllSettingsDirectly);
    
    // Add event listeners for TOTP removal modal
    document.getElementById('closeModal').addEventListener('click', closeTOTPRemoveModal);
    document.getElementById('cancelRemove').addEventListener('click', closeTOTPRemoveModal);
    document.getElementById('confirmRemove').addEventListener('click', confirmSiteRemoval);
    
    // Allow Enter key for TOTP removal input
    document.getElementById('totpRemoveInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            confirmSiteRemoval();
        }
    });
    
    // Close modal when clicking outside
    document.getElementById('totpRemoveModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeTOTPRemoveModal();
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !document.getElementById('totpRemoveModal').classList.contains('hidden')) {
            closeTOTPRemoveModal();
        }
    });
});

// Load settings from storage
function loadSettings() {
    chrome.storage.sync.get(['hasGeneratedInitialQR', 'totpSecret', 'totpSetupUri', 'setupCompleted'], function(result) {
        hasGeneratedInitialQR = result.hasGeneratedInitialQR || false;
        totpSecret = result.totpSecret || null;
        totpSetupUri = result.totpSetupUri || null;
        setupCompleted = result.setupCompleted || false;
        
        updateUIState();
        updateSetupUI();
    });
}

// Update UI based on current state
function updateUIState() {
    const firstTimeSection = document.getElementById('firstTimeSection');
    const totpVerificationSection = document.getElementById('totpVerificationSection');
    const resetWithTOTP = document.getElementById('resetWithTOTP');
    const resetWithoutTOTP = document.getElementById('resetWithoutTOTP');
    
    if (!hasGeneratedInitialQR) {
        // First time - show generate button
        firstTimeSection.classList.remove('hidden');
        totpVerificationSection.classList.add('hidden');
        
        // Reset available without TOTP
        resetWithTOTP.classList.add('hidden');
        resetWithoutTOTP.classList.remove('hidden');
    } else {
        // Not first time - show TOTP verification
        firstTimeSection.classList.add('hidden');
        totpVerificationSection.classList.remove('hidden');
        
        // Reset requires TOTP
        resetWithTOTP.classList.remove('hidden');
        resetWithoutTOTP.classList.add('hidden');
    }
}

// Load blocked sites from storage
function loadBlockedSites() {
    chrome.storage.sync.get(['blockedSites'], function(result) {
        blockedSites = result.blockedSites || [];
        displayBlockedSites();
    });
}

// Display blocked sites in the list
function displayBlockedSites() {
    const listContainer = document.getElementById('blockedSitesList');
    
    if (blockedSites.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No blocked sites yet</p>';
        return;
    }
    
    listContainer.innerHTML = blockedSites.map((site, index) => `
        <div class="site-item">
            <span>${site}</span>
            <button data-index="${index}" class="remove-site-btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;">Remove</button>
        </div>
    `).join('');
    
    // Add event listeners for remove buttons
    setupRemoveButtonListeners();
}

// Setup event listeners for remove buttons
function setupRemoveButtonListeners() {
    document.querySelectorAll('.remove-site-btn').forEach(button => {
        button.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            removeSite(index);
        });
    });
}

// Add a new site to block
function addSite() {
    // Check if setup is complete before allowing site addition
    if (!setupCompleted) {
        showStatus('Please complete the initial setup before adding sites', 'error');
        return;
    }
    
    const input = document.getElementById('newSite');
    const site = input.value.trim().toLowerCase();
    
    if (!site) {
        showStatus('Please enter a website URL', 'error');
        return;
    }
    
    // Remove protocol and www if present
    const cleanSite = site.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    
    if (blockedSites.includes(cleanSite)) {
        showStatus('This site is already blocked', 'error');
        return;
    }
    
    blockedSites.push(cleanSite);
    saveBlockedSites();
    input.value = '';
    showStatus('Site added successfully', 'success');
}

// Remove a site from the blocked list
function removeSite(index) {
    if (!hasGeneratedInitialQR || !totpSecret) {
        // No TOTP configured, use simple confirmation
        if (confirm('Are you sure you want to unblock this site?')) {
            blockedSites.splice(index, 1);
            saveBlockedSites();
            showStatus('Site removed successfully', 'success');
        }
    } else {
        // TOTP is configured, show TOTP verification modal
        siteToRemoveIndex = index;
        siteToRemoveName = blockedSites[index];
        showTOTPRemoveModal();
    }
}

// Save blocked sites to storage and update rules
function saveBlockedSites() {
    chrome.storage.sync.set({ blockedSites: blockedSites }, function() {
        displayBlockedSites();
        
        // Update blocking rules in background script
        chrome.runtime.sendMessage({ action: 'updateRules' }, function(response) {
            if (chrome.runtime.lastError) {
                console.log('Background script not available yet');
            } else if (response && !response.success) {
                showStatus('Failed to update blocking rules: ' + response.error, 'error');
            }
        });
    });
}

// Generate TOTP secret
function generateTOTPSecret() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    for (let i = 0; i < 32; i++) {
        secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
}

// Generate initial TOTP setup
function generateInitialTOTPSetup() {
    if (blockedSites.length === 0) {
        showStatus('Add some sites to block first', 'error');
        return;
    }
    
    // Generate TOTP secret
    const secret = generateTOTPSecret();
    
    // Create TOTP URI (this is what gets encoded in the QR)
    const uri = `otpauth://totp/SiteBlocker?secret=${secret}&issuer=SiteBlocker&algorithm=SHA1&digits=6&period=30`;
    
    // Generate and display QR code
    generateQRCodeWithData(uri, 'One-Time Code Setup - Scan with Authenticator App');
    
    // Save everything to storage
    totpSecret = secret;
    totpSetupUri = uri;
    hasGeneratedInitialQR = true;
    
    chrome.storage.sync.set({ 
        hasGeneratedInitialQR: true,
        totpSecret: secret,
        totpSetupUri: uri
    }, function() {
        updateUIState();
        showStatus('Setup complete! Save this QR code - you can regenerate it later with your one-time code.', 'success');
    });
}

// Verify TOTP and show setup QR
function verifyTOTPAndShowSetupQR() {
    const enteredCode = document.getElementById('totpInput').value.trim();
    
    if (!enteredCode) {
        showStatus('Please enter your one-time code', 'error');
        return;
    }
    
    if (!totpSecret || !totpSetupUri) {
        showStatus('One-time code not set up. Please reset settings and set up again.', 'error');
        return;
    }
    
    // Verify TOTP code
    const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpSecret)
    });
    
    const delta = totp.validate({ token: enteredCode, window: 1 });
    
    if (delta !== null) {
        // Valid code - show the original TOTP setup QR
        generateQRCodeWithData(totpSetupUri, 'One-Time Code Setup QR - Scan with New Device');
        document.getElementById('totpInput').value = '';
        showStatus('Code verified! You can now scan this QR with your new device.', 'success');
    } else {
        showStatus('Invalid code. Please try again.', 'error');
        document.getElementById('totpInput').value = '';
    }
}

// Generate QR code with given data
function generateQRCodeWithData(data, title) {
    const canvas = document.getElementById('qrCanvas');
    const qrContainer = document.getElementById('qrContainer');
    const qrTitle = document.getElementById('qrTitle');
    
    try {
        QRCode.toCanvas(canvas, data, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        }, function(error) {
            if (error) {
                showStatus('Failed to generate QR code: ' + error.message, 'error');
                console.error('QR Code generation error:', error);
            } else {
                qrTitle.textContent = title;
                qrContainer.classList.remove('hidden');
            }
        });
    } catch (error) {
        showStatus('Failed to generate QR code: ' + error.message, 'error');
        console.error('QR Code generation error:', error);
    }
}

// Download QR code as PNG
function downloadQR() {
    const canvas = document.getElementById('qrCanvas');
    const link = document.createElement('a');
    
    // Generate filename based on current timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    link.download = `site-blocker-totp-setup-${timestamp}.png`;
    link.href = canvas.toDataURL();
    link.click();
    
    showStatus('QR code saved! Keep this file secure.', 'info');
}

// Clear QR code display
function clearQR() {
    document.getElementById('qrContainer').classList.add('hidden');
    const canvas = document.getElementById('qrCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Verify TOTP and reset all settings
function verifyTOTPAndReset() {
    // Check cooldown
    if (Date.now() < resetCooldownUntil) {
        const remainingSeconds = Math.ceil((resetCooldownUntil - Date.now()) / 1000);
        document.getElementById('resetError').textContent = `Too many attempts. Try again in ${remainingSeconds} seconds.`;
        return;
    }
    
    const enteredCode = document.getElementById('resetTotpInput').value.trim();
    const resetError = document.getElementById('resetError');
    
    // Clear previous error
    resetError.textContent = '';
    
    if (!enteredCode) {
        resetError.textContent = 'Please enter your one-time code';
        return;
    }
    
    if (!totpSecret) {
        resetError.textContent = 'One-time code not properly configured';
        return;
    }
    
    // Verify TOTP code
    const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpSecret)
    });
    
    const delta = totp.validate({ token: enteredCode, window: 1 });
    
    if (delta !== null) {
        // Valid TOTP - reset attempt counter and proceed
        resetAttempts = 0;
        resetCooldownUntil = 0;
        
        // Proceed with reset after final confirmation
        const confirmMessage = 'Code verified!\n\n' +
                              '⚠️  FINAL WARNING ⚠️\n\n' +
                              'This will permanently:\n' +
                              '• Delete all blocked sites\n' +
                              '• Remove one-time code configuration\n' +
                              '• Clear all temporary permissions\n' +
                              '• Require complete setup from scratch\n\n' +
                              'Are you absolutely sure?';
        
        if (confirm(confirmMessage)) {
            performCompleteReset();
        } else {
            document.getElementById('resetTotpInput').value = '';
            showStatus('Reset cancelled', 'info');
        }
    } else {
        // Invalid TOTP - increment attempts and set cooldown if needed
        resetAttempts++;
        document.getElementById('resetTotpInput').value = '';
        
        if (resetAttempts >= 3) {
            resetCooldownUntil = Date.now() + (30 * 1000); // 30 second cooldown
            resetError.textContent = 'Too many failed attempts. Please wait 30 seconds before trying again.';
        } else {
            resetError.textContent = `Invalid code. ${3 - resetAttempts} attempts remaining.`;
        }
    }
}

// Reset all settings directly (only when TOTP not set up)
function resetAllSettingsDirectly() {
    // This should only be available when TOTP is not set up
    if (hasGeneratedInitialQR) {
        showStatus('Error: TOTP verification required for reset', 'error');
        return;
    }
    
    const confirmMessage = 'Are you sure you want to reset all settings?\n\n' +
                          'This will remove all blocked sites.\n' +
                          'This action cannot be undone.';
    
    if (confirm(confirmMessage)) {
        performCompleteReset();
    }
}

// Perform the complete reset
function performCompleteReset() {
    // Show loading state
    const resetButton = document.querySelector('#resetWithTOTP button, #resetWithoutTOTP button');
    const originalText = resetButton.textContent;
    resetButton.textContent = 'Resetting...';
    resetButton.disabled = true;
    
    // Clear both sync and local storage
    chrome.storage.sync.clear(function() {
        chrome.storage.local.clear(function() {
            // Reset local variables
            blockedSites = [];
            hasGeneratedInitialQR = false;
            totpSecret = null;
            totpSetupUri = null;
            setupCompleted = false;
            resetAttempts = 0;
            resetCooldownUntil = 0;
            
            // Reset UI
            displayBlockedSites();
            clearQR();
            updateUIState();
            
            // Clear all input fields
            document.getElementById('newSite').value = '';
            if (document.getElementById('totpInput')) {
                document.getElementById('totpInput').value = '';
            }
            if (document.getElementById('resetTotpInput')) {
                document.getElementById('resetTotpInput').value = '';
            }
            if (document.getElementById('resetError')) {
                document.getElementById('resetError').textContent = '';
            }
            
            // Restore button state
            resetButton.textContent = originalText;
            resetButton.disabled = false;
            
            showStatus('All settings have been completely reset. You can now set up from scratch.', 'success');
            
            // Update background script rules
            chrome.runtime.sendMessage({ action: 'updateRules' });
        });
    });
}

// Show status message
function showStatus(message, type) {
    const statusElement = document.getElementById('statusMessage');
    statusElement.textContent = message;
    statusElement.className = `status-message ${type}`;
    statusElement.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusElement.classList.add('hidden');
    }, 5000);
}

// Show TOTP removal modal
function showTOTPRemoveModal() {
    const modal = document.getElementById('totpRemoveModal');
    const siteNameElement = document.getElementById('siteToRemove');
    const totpInput = document.getElementById('totpRemoveInput');
    const errorElement = document.getElementById('totpRemoveError');
    
    siteNameElement.textContent = siteToRemoveName;
    totpInput.value = '';
    errorElement.textContent = '';
    
    modal.classList.remove('hidden');
    
    // Focus on TOTP input
    setTimeout(() => {
        totpInput.focus();
    }, 100);
}

// Close TOTP removal modal
function closeTOTPRemoveModal() {
    const modal = document.getElementById('totpRemoveModal');
    const totpInput = document.getElementById('totpRemoveInput');
    const errorElement = document.getElementById('totpRemoveError');
    
    modal.classList.add('hidden');
    totpInput.value = '';
    errorElement.textContent = '';
    
    // Reset removal state
    siteToRemoveIndex = -1;
    siteToRemoveName = '';
}

// Confirm site removal with TOTP verification
function confirmSiteRemoval() {
    const enteredCode = document.getElementById('totpRemoveInput').value.trim();
    const errorElement = document.getElementById('totpRemoveError');
    
    // Clear previous error
    errorElement.textContent = '';
    
    if (!enteredCode) {
        errorElement.textContent = 'Please enter your one-time code';
        return;
    }
    
    if (!totpSecret) {
        errorElement.textContent = 'One-time code not configured';
        return;
    }
    
    if (siteToRemoveIndex === -1 || !siteToRemoveName) {
        errorElement.textContent = 'Invalid removal request';
        return;
    }
    
    // Verify TOTP code
    const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(totpSecret)
    });
    
    const delta = totp.validate({ token: enteredCode, window: 1 });
    
    if (delta !== null) {
        // Valid TOTP - proceed with removal
        blockedSites.splice(siteToRemoveIndex, 1);
        saveBlockedSites();
        closeTOTPRemoveModal();
        showStatus(`Site "${siteToRemoveName}" removed successfully`, 'success');
    } else {
        errorElement.textContent = 'Invalid code. Please try again.';
        document.getElementById('totpRemoveInput').value = '';
    }
}