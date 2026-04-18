// verify_impl.js - Standalone test for JS wrapper logic
// This emulates the logic added to app.js

function stripJsWrapper(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length >= 3) {
    if (lines[0].includes('Tour links definition') && lines[1].includes('var embeddedData')) {
      return lines.slice(2, -1).join('\n');
    }
  }
  return content;
}

function wrapJsWrapper(text) {
  return `// Tour links definition:
var embeddedData = \`
${text}
\`;  //   REQUIRED closing single quote is at left!!`;
}

const testContent = `! Test Tour JS
+ TEST_
$1 Test Locale
0001 hN f0002
Test description`;

const wrappedContent = `// Tour links definition:
var embeddedData = \`
! Test Tour JS
+ TEST_
$1 Test Locale
0001 hN f0002
Test description
\`;  //   REQUIRED closing single quote is at left!!`;

// Test 1: Stripping
const stripped = stripJsWrapper(wrappedContent);
console.log("Test 1 (Stripping):", stripped === testContent ? "PASS" : "FAIL");
if (stripped !== testContent) {
    console.log("Expected:\n" + testContent);
    console.log("Got:\n" + stripped);
}

// Test 2: Wrapping
const wrapped = wrapJsWrapper(testContent);
console.log("Test 2 (Wrapping):", wrapped === wrappedContent ? "PASS" : "FAIL");
if (wrapped !== wrappedContent) {
    console.log("Expected:\n" + wrappedContent);
    console.log("Got:\n" + wrapped);
}

// Test 3: Round-trip
const roundTrip = stripJsWrapper(wrapJsWrapper(testContent));
console.log("Test 3 (Round-trip):", roundTrip === testContent ? "PASS" : "FAIL");
