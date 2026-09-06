/* Invitations now resolve to the unified authenticated dashboard. */
window.BedehShared = { open(token) {
  if (window.BedehUnified) return window.BedehUnified.claim(token);
  // The deferred unified script handles the initial URL after account setup.
} };