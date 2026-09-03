# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vanilla HTML, CSS, and JavaScript with Supabase Auth, PostgreSQL, Edge Functions, and PWA APIs.

## Users

People in Iran who need a clear, mutual record for a borrowed item, a personal loan, or a shared expense with friends, family, or colleagues.

## Product Purpose

بده‌بستان records informal obligations clearly, gives each counterpart a secure record link, and supports respectful confirmation and reminders before the due date.

## Positioning

A single-record, mutually visible obligation log with recipient confirmation, rather than a chat, bank, social network, or generic finance dashboard.

## Operating Context

Mobile-first browser use around real-world handovers, repayments, and group bills. Recipients open scoped record links or QR codes without a full account.

## Capabilities and Constraints

Records items, money loans, and shared expenses; calculates balances and settlements; records partial repayments and payment claims; uses high-entropy server-side share tokens; supports link revocation/replacement; persists records in Supabase behind RLS. Account owners sign in with email and password. The product never requests banking credentials, CVV2, card expiry, PIN, OTP, or payment authorization. Browser notifications require consent and fall back to in-app reminders.

## Brand Commitments

The name is بده‌بستان. Persian RTL is the default. Copy is direct, respectful, and action-oriented. Persian dates/numerals and toman are defaults. Dark mode is compact and available.

## Evidence on Hand

The user supplied the complete functional brief. There are no supplied logos, photos, customer claims, or external integrations; the build must not invent them.

## Product Principles

- A record is clear before it is clever.
- Every change remains attributable in the timeline.
- A link exposes exactly one intended record and nothing else.
- Payment claims are records, never transfers.

## Accessibility & Inclusion

Mobile-first keyboard-accessible controls, explicit labels, visible focus, sufficient contrast, reduced-motion support, and meaningful empty/error states.
