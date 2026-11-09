const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync('src/utils/organizationOwner.ts','utf8');
const sandbox={exports:{},require:()=>({parseOrganizationId:value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null})};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,sandbox);
const check=sandbox.exports.verifiedOwnerOrganization;
const resolveMatchOwner=sandbox.exports.resolveMatchOwner;
const user={id:'verified',email:'azamat@havas.uz',email_confirmed_at:'2026-01-01'};
test('verified owner resolves exact organization including customer one',()=>assert.equal(check(user,[{id:1,admin_email:'azamat@havas.uz'}]),1));
test('missing owner has no default; duplicates and another owner are rejected',()=>{
 assert.equal(check(user,[]),null);
 assert.throws(()=>check(user,[{id:1,admin_email:'other@example.com'}]));
 assert.throws(()=>check(user,[{id:1},{id:2}]));
 assert.throws(()=>check({...user,email_confirmed_at:undefined},[{id:1,admin_email:user.email}]));
});

test('only an unavailable owner RPC can use the previous verified lookup', async () => {
 let legacyLookups = 0;
 const mock = (data, error = null) => ({
  rpc: () => ({ maybeSingle: async () => ({ data, error }) }),
  from: () => ({
   select: () => ({
    ilike: (_field, email) => ({
     limit: async () => {
      legacyLookups++;
      assert.equal(email, user.email);
      return { data: [{ id: 2, admin_email: user.email }], error: null };
     },
    }),
   }),
  }),
 });
 assert.equal(await resolveMatchOwner(mock(null, { code: 'PGRST202' }), user), 2);
 assert.equal(await resolveMatchOwner(mock({ auth_user_id: user.id, organization_id: 3 }), user), 3);
 assert.equal(await resolveMatchOwner(mock({ auth_user_id: 'different', organization_id: 3 }), user), null);
 assert.equal(await resolveMatchOwner(mock(null), user), null);
 await assert.rejects(resolveMatchOwner(mock(null, { code: '42501' }), user), /vakolatini/);
 assert.equal(legacyLookups, 1);
});
