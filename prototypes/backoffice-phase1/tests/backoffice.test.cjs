const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
test('backoffice browser JavaScript parses',()=>{assert.ok(js);assert.doesNotThrow(()=>new Function(js))});
test('requires email OTP and privileged role',()=>{assert.match(js,/\/api\/auth\/verify-email/);assert.match(js,/system_admin/);assert.match(js,/back_office/);assert.match(js,/master_agency/)});
test('manual inventory workflow is wired',()=>{for(const route of ['/api/admin/hotels','/api/admin/rooms/','/api/admin/rate-plans/','/api/admin/publications'])assert.ok(js.includes(route),route)});
test('booking approval and rejection endpoints wired',()=>{assert.match(js,/\/api\/backoffice\/bookings/);assert.match(js,/approved/);assert.match(js,/rejected/)});
test('never injects server response as HTML',()=>{assert.doesNotMatch(js,/\.innerHTML\s*=/);assert.match(js,/textContent/)});
test('does not embed external supplier credentials',()=>assert.doesNotMatch(html,/Hotelbeds|TravelgateX|supplierId|netPrice|BEGIN PRIVATE KEY/));
