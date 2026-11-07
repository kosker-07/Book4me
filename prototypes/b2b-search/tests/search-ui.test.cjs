// BED4BOOK B2B search prototype contract tests. Node 22+, no third-party dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('inline browser JavaScript parses', () => {
  assert.ok(script, 'inline script exists');
  assert.doesNotThrow(() => new Function(script));
});
test('login uses real backend and never embeds credentials', () => {
  assert.match(script, /\/api\/auth\/login/);
  assert.match(script, /\/api\/auth\/logout/);
  assert.doesNotMatch(html, /sk_(?:live|test)_|BEGIN PRIVATE KEY|password\s*:\s*['"][^'"]+['"]/i);
});
test('search calls agency endpoint with auth header', () => {
  assert.match(script, /\/api\/agency\/searches/);
  assert.match(script, /Authorization:'Bearer '\+token/);
  assert.match(script, /childAges/);
});
test('unsupported room distribution cannot be submitted', () => {
  assert.match(script, /if\(rooms\.length!==1\)/);
  assert.match(html, /Çoklu oda için oda bazında doluluk/);
});
test('unimplemented booking action is disabled', () => {
  assert.match(script, /b\.disabled=true/);
  assert.doesNotMatch(script, /\/api\/agency\/bookings/);
});
test('supplier identifiers and internal pricing are absent from UI', () => {
  assert.doesNotMatch(html, /supplierId|supplierName|ratePlanId|netPrice|markupValue|apiKey|secretKey/);
  assert.doesNotMatch(html, /Hotelbeds|TravelgateX|WebBeds|Juniper|Bedsopia/);
});
test('server data rendered with textContent rather than innerHTML', () => {
  assert.match(script, /\.textContent=String\(txt\)/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});
test('search validates date and night range', () => {
  assert.match(script, /nights>=1&&nights<=60/);
  assert.match(script, /ci<today\(\)/);
});
test('this prototype does not claim to implement OTP', () => {
  assert.doesNotMatch(script, /\/api\/auth\/otp\/verify/);
});
