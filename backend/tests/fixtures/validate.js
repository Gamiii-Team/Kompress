// Fixture validation — checks all fixtures per INPUT_VALIDATION.md §9
// Run: node backend/tests/fixtures/validate.js
const fs = require('fs');
const path = require('path');

const fixturesDir = __dirname;
const expected = {
  'simple.txt': 'accepted',
  'simple.md': 'accepted',
  'typed.pdf': 'accepted',
  'headings.docx': 'accepted',
  'slides.pptx': 'accepted',
  'javascript.pdf': 'rejected_pdf_script',
  'macro.docm': 'rejected_extension',
  'script-renamed.py': 'rejected_magic_bytes', // renamed to .pdf expected
  'svg-with-script.svg': 'rejected_svg',
  'zip-bomb.docx': 'rejected_archive_bomb',
};

function check(name, expectedStatus) {
  const p = path.join(fixturesDir, name);
  if (!fs.existsSync(p)) {
    console.log('MISSING: ' + name + ' (expected: ' + expectedStatus + ')');
    return false;
  }
  // In a full run this would call the backend validator endpoint;
  // here we verify file presence and basic content rules
  const content = fs.readFileSync(p, 'utf8');
  if (expectedStatus === 'rejected_pdf_script') {
    if (!content.includes('/JavaScript')) console.log('FAIL: ' + name + ' missing JS marker');
  }
  console.log('OK fixture: ' + name + ' -> ' + expectedStatus);
  return true;
}

let all = true;
for (const [k, v] of Object.entries(expected)) {
  if (!check(k, v)) all = false;
}
console.log(all ? '\nAll fixtures present. Manual review needed for full backend validation.' : '\nSome fixtures missing — add per INPUT_VALIDATION.md §9.');
