export function hasTransferConsents(transfer: any): boolean {
  if (!transfer.app_consent_required) return true;
  return ['player', 'old_team', 'new_team'].every(party => Boolean(transfer[party === 'player' ? 'player_id' : `${party}_id`]) && (transfer.transfer_consents || []).some((consent: any) =>
    consent.party === party && consent.decision === 'approved' &&
    consent.subject_id === transfer[party === 'player' ? 'player_id' : `${party}_id`]));
}
