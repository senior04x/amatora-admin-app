const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync('src/utils/organizationOwner.ts','utf8');
const sandbox={exports:{},require:()=>({parseOrganizationId:value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null})};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
const check=sandbox.exports.verifiedOwnerOrganization;
const user={id:'verified',email:'azamat@havas.uz',email_confirmed_at:'2026-01-01'};
test('verified owner resolves exact organization including customer one',()=>assert.equal(check(user,[{id:1,admin_email:'azamat@havas.uz'}]),1));
test('missing owner has no default; duplicates and another owner are rejected',()=>{
 assert.equal(check(user,[]),null);
 assert.throws(()=>check(user,[{id:1,admin_email:'other@example.com'}]));
 assert.throws(()=>check(user,[{id:1},{id:2}]));
 assert.throws(()=>check({...user,email_confirmed_at:undefined},[{id:1,admin_email:user.email}]));
});
