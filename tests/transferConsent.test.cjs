const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/transferConsent.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', output)(mod.exports, mod);
const { hasTransferConsents } = mod.exports;
const row = { app_consent_required: true, player_id: 'p', old_team_id: 'o', new_team_id: 'n' };
const consents = ['player', 'old_team', 'new_team'].map(party => ({ party, decision: 'approved', subject_id: row[party === 'player' ? 'player_id' : `${party}_id`] }));
test('legacy web requests do not require mobile consent', () => assert.equal(hasTransferConsents({}), true));
test('all three current participants must explicitly approve', () => {
 assert.equal(hasTransferConsents(row), false);
 assert.equal(hasTransferConsents({ ...row, transfer_consents: consents }), true);
 for (let i = 0; i < 3; i++) {
  for (const change of [{ decision: 'rejected' }, { subject_id: 'foreign' }]) {
   const list = consents.map((c, index) => index === i ? { ...c, ...change } : c);
   assert.equal(hasTransferConsents({ ...row, transfer_consents: list }), false);
  }
 }
});
test('missing participant IDs fail closed', () => assert.equal(hasTransferConsents({ app_consent_required: true, transfer_consents: consents.map(c => ({ ...c, subject_id: undefined })) }), false));
