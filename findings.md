# Findings and Decisions

## Requirements

- Three obligation types: item, money, and shared expense.
- Local persistence, scoped secure-like record links, QR generation, recipient actions, calculations, link revocation, reminders, card safety, and export.
- Persian RTL mobile-first PWA with Persian numerals/dates and compact dark mode.

## Research Findings

- The workspace is empty, so a dependency-free browser PWA is appropriate for localhost use.
- The supplied UI guidance prioritizes 44px targets, visible labels/focus, reduced motion, semantic color tokens, and responsive RTL layout.

## Technical Decisions

| Decision | Rationale |
|---|---|
| Hash-based recipient sharing | Works on a static local server while keeping the main dashboard separate from the recipient view. |
| Web Crypto token generation | Opaque, non-guessable share identifiers without exposing card details in a URL or QR payload. |
| Iranian card checksum and BIN map | Validates card format and shows a factual issuing-bank hint without asserting ownership. |

## Issues Encountered

| Issue | Resolution |
|---|---|
| UI design-system search command blocked by environment allowlist | Continued from explicit brief and loaded design rules; no unverified search result used. |
| Batched create failed | Used separate safe file creates. |
