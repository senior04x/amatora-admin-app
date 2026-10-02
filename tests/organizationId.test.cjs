const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/utils/organizationId.ts'), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const sandbox = {exports: {}};
vm.runInNewContext(compiled, sandbox);
const {parseOrganizationId, requireOrganizationId} = sandbox.exports;
test('missing and malformed organizations never resolve to a customer', () => {
  for (const value of [null, undefined, '', '1abc', '1.5', 'Infinity', true, false, {}, [], 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseOrganizationId(value), null);
    assert.throws(() => requireOrganizationId(value));
  }
});
test('valid customer IDs including the first customer remain intact', () => {
  for (const value of [1, '1', 2, '2', ' 42 ']) {
    assert.equal(requireOrganizationId(value), Number(value));
  }
});
