const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/utils/adminMembership.ts'),'utf8');
const sandbox={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
const validate=sandbox.exports.validatedAdminOrganization;
test('verified UID membership retains exact organization including customer one',()=>{
 assert.equal(validate('verified',{id:'verified',role:'org_admin',organization_id:1}),1);
 assert.equal(validate('verified',{id:'verified',role:'super_admin',organization_id:2}),2);
});
test('wrong UID, role and missing organization never resolve to a customer',()=>{
 for(const record of [null,{id:'other',role:'org_admin',organization_id:1},
  {id:'verified',role:'user',organization_id:1},{id:'verified',role:'org_admin',organization_id:null},
  {id:'verified',role:'org_admin',organization_id:'1'},{id:'verified',role:'org_admin',organization_id:0}])
  assert.throws(()=>validate('verified',record));
});
