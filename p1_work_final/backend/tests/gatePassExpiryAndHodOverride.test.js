'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const route=fs.readFileSync(path.join(__dirname,'../src/routes/gatePasses.js'),'utf8');
const verifier=fs.readFileSync(path.join(__dirname,'../../frontend/gate-pass-verify.html'),'utf8');
const main=fs.readFileSync(path.join(__dirname,'../../mainapp.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../../frontend/app-runtime.js'),'utf8');

assert.doesNotMatch(route,/GATE_PASS_QR_TTL_MS/);
assert.match(route,/function gatePassExpiryFromOutTime\(data\)/);
assert.match(route,/const expiresAt=gatePassExpiryFromOutTime\(data\)/);
assert.match(route,/3 hours after that mentioned departure time/);
assert.match(route,/\['teacher_mentor','guardian','hod'\]\.includes\(String\(data\.stage\|\|''\)\)/);
assert.match(route,/hodOverrideStage/);
assert.match(route,/status:'approved'/);
assert.match(route,/qrUsed:false/);
assert.match(route,/OR: \[\{ expiresAt: null \}, \{ expiresAt: \{ gt: new Date\(\) \} \}\]/);
assert.match(route,/status:'expired'/);
assert.match(verifier,/AbortController/);
assert.match(verifier,/30000/);
assert.match(verifier,/Verification did not complete within 30 seconds/);
assert.match(verifier,/successful result is/);
assert.doesNotMatch(verifier,/setTimeout\(\(\)=>renderInvalid\('expired'/);
for (const src of [main,runtime]) {
  assert.match(src,/const _gatePassRedeemOnce = async \(id,token\) =>/);
  assert.match(src,/controller\.abort\(\),30000/);
  assert.match(src,/HOD\/Admin final override/);
  assert.match(src,/\['teacher_mentor','guardian','hod'\]\.includes\(p\.stage\)/);
}
assert.match(verifier,/3-hour gate-pass time limit/);
console.log('Gate-pass 3-hour out-time expiry + 30-second verification-window + HOD final-override regression checks passed.');
