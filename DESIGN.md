# Design

## Visual world

**Mutual ledger.** An operational record surface inspired by the clarity of a well-kept personal ledger: cool ink field, warm paper-like reading surfaces, one disciplined teal action color, and hairline dividers that make responsibility readable without making the interface feel financial or institutional.

## Mode

Operate. The user must scan status, create a record, share it, and confirm a change quickly from a phone.

## Tokens

- Ink: `#0E1B2B`; paper: `#F7F4EE`; surface: `#FFFFFF`; teal: `#087E7D`; coral is reserved for destructive actions.
- Vazirmatn system fallback stack; Persian numerals use tabular figures in amounts.
- Soft 14px cards, 8px fields, small rounded status chips.
- 4/8px spacing rhythm, 48px controls, and compact fixed mobile navigation.

## Interaction

State changes use a single quick opacity/translate transition. Reduced-motion removes it. Primary actions stay visible; a compact bottom action bar owns creation on phones. Light/dark mode maps semantic tokens instead of inverting arbitrary sections.

## Accessibility

Visible focus rings, labels above fields, aria-live feedback, semantic buttons, contrast-safe text, and keyboard-usable dialogs.
