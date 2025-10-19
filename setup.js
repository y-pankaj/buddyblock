// setup.js - First-time setup logic

let generatedSecret = null;
let totp = null;

// Generate TOTP secret and display QR code
async function generateSetupQR() {
  try {
    // Check if setup already completed
    const { setupCompleted } = await chrome.storage.sync.get('setupCompleted');
    if (setupCompleted) {
      // Already set up, redirect to options
      window.location.href = chrome.runtime.getURL('options.html');
      return;
    }

    // Generate a new TOTP secret
    generatedSecret = new OTPAuth.Secret({ size: 20 });
    totp = new OTPAuth.TOTP({
      issuer: 'BuddyBlock',
      label: 'AccountabilityPartner',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: generatedSecret
    });

    const otpauthURL = totp.toString();

    // Generate QR code
    const canvas = document.getElementById('qrCanvas');
    await QRCode.toCanvas(canvas, otpauthURL, {
      width: 250,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Hide loading, show QR
    document.getElementById('loadingSpinner').style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('qrActions').style.display = 'block';
    document.getElementById('secretText').textContent = generatedSecret.base32;

    // Enable verify button
    document.getElementById('verifyBtn').disabled = false;

  } catch (error) {
    console.error('Error generating QR:', error);
    showError('Failed to generate QR code. Please reload the page.');
  }
}

// Verify TOTP code entered by user
async function verifySetup() {
  const enteredCode = document.getElementById('verifyInput').value.trim();
  const errorMsg = document.getElementById('errorMessage');
  const successMsg = document.getElementById('successMessage');
  const verifyBtn = document.getElementById('verifyBtn');

  // Clear previous messages
  errorMsg.classList.remove('show');
  successMsg.classList.remove('show');

  // Validate input
  if (!enteredCode) {
    showError('Please enter the 6-digit code from your authenticator app.');
    return;
  }

  if (enteredCode.length !== 6 || !/^\d{6}$/.test(enteredCode)) {
    showError('Please enter a valid 6-digit code (numbers only).');
    return;
  }

  if (!totp) {
    showError('Setup not initialized. Please reload the page.');
    return;
  }

  // Disable button during verification
  verifyBtn.disabled = true;
  verifyBtn.textContent = 'Verifying...';

  try {
    // Validate the TOTP code
    const delta = totp.validate({ token: enteredCode, window: 1 });

    if (delta !== null) {
      // Code is valid! Save everything
      await chrome.storage.sync.set({
        totpSecret: generatedSecret.base32,
        setupCompleted: true,
        hasGeneratedInitialQR: true,
        setupTimestamp: Date.now()
      });

      // Show success message
      successMsg.textContent = '✅ Setup completed successfully! Redirecting...';
      successMsg.classList.add('show');

      // Redirect to options page after 2 seconds
      setTimeout(() => {
        window.location.href = chrome.runtime.getURL('options.html');
      }, 2000);

    } else {
      // Invalid code
      showError('Invalid code. Please check your authenticator app and try again.');
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Complete Setup';
    }

  } catch (error) {
    console.error('Verification error:', error);
    showError('Verification failed. Please try again.');
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Complete Setup';
  }
}

// Download QR code as PNG
function downloadQR() {
  const canvas = document.getElementById('qrCanvas');
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `buddyblock-qr-${Date.now()}.png`;
  link.href = url;
  link.click();
}

// Toggle secret visibility
function toggleSecret() {
  const secretInfo = document.getElementById('secretInfo');
  const btn = document.getElementById('toggleSecretBtn');
  
  if (secretInfo.style.display === 'none') {
    secretInfo.style.display = 'block';
    btn.textContent = '🔒 Hide Manual Code';
  } else {
    secretInfo.style.display = 'none';
    btn.textContent = '🔑 Show Manual Code';
  }
}

// Show error message
function showError(message) {
  const errorMsg = document.getElementById('errorMessage');
  errorMsg.textContent = message;
  errorMsg.classList.add('show');
}

// Warn user if they try to close without completing
window.addEventListener('beforeunload', (event) => {
  const verifyInput = document.getElementById('verifyInput').value;
  const { setupCompleted } = chrome.storage.sync.get('setupCompleted');
  
  if (!verifyInput && !setupCompleted) {
    event.preventDefault();
    event.returnValue = 'Setup is not complete. The extension will not work until you finish setup. Are you sure you want to leave?';
  }
});

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Generate QR on load
  generateSetupQR();

  // Verify button
  document.getElementById('verifyBtn').addEventListener('click', verifySetup);

  // Enter key on input
  document.getElementById('verifyInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      verifySetup();
    }
  });

  // Enable verify button when user types
  document.getElementById('verifyInput').addEventListener('input', (e) => {
    const value = e.target.value;
    const verifyBtn = document.getElementById('verifyBtn');
    
    // Only allow numbers
    e.target.value = value.replace(/[^0-9]/g, '');
    
    // Enable button if 6 digits entered
    if (e.target.value.length === 6) {
      verifyBtn.disabled = false;
    }
  });

  // Download QR button
  document.getElementById('downloadQRBtn').addEventListener('click', downloadQR);

  // Toggle secret button
  document.getElementById('toggleSecretBtn').addEventListener('click', toggleSecret);
});

