/* Kept separate from application state: the PWA worker must not depend on
   the legacy local-storage app bootstrap. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => {
    console.warn('Service worker registration failed.', error);
  }));
}
