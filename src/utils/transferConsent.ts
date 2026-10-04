export function hasTransferConsents(transfer: any): boolean {
  if (!transfer.app_consent_required) return true;
  return ['old_team', 'new_team'].every(party => Boolean(transfer[`${party}_id`]) && (transfer.transfer_consents || []).some((consent: any) =>
    consent.party === party && consent.decision === 'approved' &&
    consent.subject_id === transfer[`${party}_id`]));
}
