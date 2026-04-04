// Restore state from localStorage
Persistence.load();

// Initialize UI modules
OffsetInput.init();
Analog.init();
UI.init();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// PWA install prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (localStorage.getItem('install_dismissed')) return;
  deferredPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.className = 'install-banner';
  banner.innerHTML = `
    <span>Install Stopwatch for quick access</span>
    <button id="install-btn" class="install-btn">Install</button>
    <button id="install-dismiss" class="install-dismiss">&times;</button>
  `;
  document.getElementById('app').prepend(banner);
  requestAnimationFrame(() => banner.classList.add('install-visible'));

  document.getElementById('install-btn').addEventListener('click', () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    }
    banner.remove();
  });

  document.getElementById('install-dismiss').addEventListener('click', () => {
    localStorage.setItem('install_dismissed', '1');
    banner.remove();
  });
}
