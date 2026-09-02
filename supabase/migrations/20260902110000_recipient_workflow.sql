-- Recipient actions are first-class, server-recorded workflow states. They
-- notify the creator without granting a public share-link access to any other record.
alter type public.notification_kind add value if not exists 'receipt_confirmed';
alter type public.notification_kind add value if not exists 'extension_requested';
alter type public.notification_kind add value if not exists 'return_requested';
alter type public.notification_kind add value if not exists 'repayment_recorded';
alter type public.notification_kind add value if not exists 'return_confirmed';

alter table public.record_events drop constraint if exists record_events_event_type_check;
alter table public.record_events add constraint record_events_event_type_check check (
  event_type in (
    'record_created','share_link_created','receipt_confirmed','extension_requested',
    'repayment_recorded','repayment_confirmed','item_returned','link_revoked',
    'reminder_sent','due_date_changed','return_requested','return_confirmed'
  )
);
