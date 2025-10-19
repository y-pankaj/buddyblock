
// blocked.js

document.getElementById('request-access').addEventListener('click', () => {
    document.getElementById('pin-form').style.display = 'block';
  });

  document.getElementById('submit-pin').addEventListener('click', async () => {
    const pinError = document.getElementById('pin-error');
    pinError.textContent = '';

    const enteredToken = document.getElementById('pin-input').value;
    const urlParams = new URLSearchParams(window.location.search);
    const siteDomain = urlParams.get('site');

    // Improved error checking
    if (!siteDomain) {
      pinError.textContent = "Error: Domain not found. Please try visiting the site again.";
      return;
    }
    if (!enteredToken) {
      pinError.textContent = "Please enter the 6-digit code.";
      return;
    }

    const { totpSecret } = await chrome.storage.sync.get('totpSecret');
    if (!totpSecret) {
      pinError.textContent = "TOTP secret not set in options.";
      return;
    }

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(totpSecret)
    });

    const delta = totp.validate({ token: enteredToken, window: 1 });

    if (delta !== null) {
      // Code is valid. Grant access for 30 minutes.
      const expiry = Date.now() + 30 * 60 * 1000;
      const { tempAllowedSites = {} } = await chrome.storage.local.get('tempAllowedSites');
      tempAllowedSites[siteDomain] = expiry;

      await chrome.storage.local.set({ tempAllowedSites });

      // Redirect back to the originally intended site.
      window.location.href = `https://${siteDomain}`;
    } else {
      pinError.textContent = "Invalid code.";
    }
  });
