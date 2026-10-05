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
const consents = ['old_team', 'new_team'].map(party => ({ party, decision: 'approved', subject_id: row[`${party}_id`] }));
test('free agents require the new captain but waive old captain consent',()=>{
 assert.equal(hasTransferConsents({...row,old_team_consent_required:false,transfer_consents:[consents[1]]}),true);
 assert.equal(hasTransferConsents({...row,old_team_consent_required:false,transfer_consents:[]}),false);
});
test('legacy web requests do not require mobile consent', () => assert.equal(hasTransferConsents({}), true));
test('both current teams must explicitly approve', () => {
 assert.equal(hasTransferConsents(row), false);
 assert.equal(hasTransferConsents({ ...row, transfer_consents: consents }), true);
 for (let i = 0; i < 2; i++) {
  for (const change of [{ decision: 'rejected' }, { subject_id: 'foreign' }]) {
   const list = consents.map((c, index) => index === i ? { ...c, ...change } : c);
   assert.equal(hasTransferConsents({ ...row, transfer_consents: list }), false);
  }
 }
});
test('historical player rejection cannot veto team consent or replace it', () => {
 const player = { party:'player',subject_id:'p',decision:'rejected' };
 assert.equal(hasTransferConsents({...row,transfer_consents:[...consents,player]}),true);
 assert.equal(hasTransferConsents({...row,transfer_consents:[consents[0],{...player,decision:'approved'}]}),false);
});
test('missing participant IDs fail closed', () => assert.equal(hasTransferConsents({ app_consent_required: true, transfer_consents: consents.map(c => ({ ...c, subject_id: undefined })) }), false));
