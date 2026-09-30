const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../../frontend/app-runtime.js'), 'utf8');

assert.match(src, /const aiScore = misNum\(j\.score/);
assert.match(src, /const localScore = local\(\)\.score/);
assert.match(src, /0\.65 \* aiScore \+ 0\.35 \* localScore/);
assert.match(src, /const evidenceCap = Math\.min\(10, localScore \+ 2\.0\)/);
assert.match(src, /source: 'ai-calibrated'/);
assert.match(src, /const qaScores = qa\.map\(\(a\) => a\.score\)/);
assert.doesNotMatch(src, /const qaScores = qa\.concat\(skipped\)\.map/);
assert.match(src, /const confidence = Math\.round\(0\.65 \* evidenceQuality \+ 0\.35 \* liveCoverage\)/);
assert.match(src, /scoreProvenance/);
console.log('Advanced project-review evidence calibration checks passed.');
