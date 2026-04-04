// Restore state from localStorage
Persistence.load();

// Initialize UI modules
OffsetInput.init();
UI.init();

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
