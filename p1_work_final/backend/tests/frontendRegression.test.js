'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../../frontend/index.html'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../../frontend/app-runtime.js'),'utf8');
assert(html.includes('((twin && twin.weakestSkills) || [])'), 'Digital Twin must not dereference twin while loading.');
assert(html.includes('((twin && twin.strongestSkills) || [])'), 'Digital Twin strongest-skills list must be null-safe.');
assert(html.includes('Could not send the password recovery email. Please check the Email Delivery configuration.'), 'Recovery UI must report delivery/configuration failure clearly.');
// v14: one click = one delivery request. Provider retries (429/5xx) are owned by the server, not the browser.
assert(!html.includes('attempt<2&&[429,502,503,504].includes(rr.status)'), 'Recovery client must not retry in the browser (duplicate mails / EmailJS rate limits).');
assert(html.includes('/api/portal-auth/recovery/start'), 'Recovery client must call the server recovery endpoint.');
const mailer=fs.readFileSync(path.join(__dirname,'../src/services/recoveryMailer.js'),'utf8');
assert(/retryable\s*&&\s*attempt\s*<\s*maxRetries/.test(mailer), 'Server recovery mailer must retry transient EmailJS 429/5xx responses.');
console.log('Frontend regression checks passed.');
