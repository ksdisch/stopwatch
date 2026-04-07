let _passed = 0;
let _failed = 0;
let _currentDescribe = '';
const _output = [];

function describe(name, fn) {
  _currentDescribe = name;
  _output.push(`\n  ${name}`);
  fn();
  _currentDescribe = '';
}

function it(name, fn) {
  try {
    fn();
    _passed++;
    _output.push(`    ✓ ${name}`);
  } catch (e) {
    _failed++;
    _output.push(`    ✗ ${name} — ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(msg || `Expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

function reportResults() {
  const total = _passed + _failed;
  const summary = `\n  ${total} tests: ${_passed} passed, ${_failed} failed`;
  _output.push(summary);

  const text = _output.join('\n');
  console.log(text);

  const el = document.getElementById('results');
  if (el) {
    el.textContent = text;
    el.style.color = _failed > 0 ? '#ff453a' : '#30d158';
  }

  document.title = _failed > 0 ? `FAIL (${_failed})` : `PASS (${_passed})`;
}
