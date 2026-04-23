let _passed = 0;
let _failed = 0;
const _output = [];
// Queue of { type: 'describe' | 'it', name, fn? } entries. describe() and
// it() just push; execution happens when reportResults() is awaited. This
// lets test functions be async (e.g. Analytics.getFocusStreak() awaits
// History.getSessions()) without rewriting existing sync tests — a sync
// it() callback is awaited the same way (a non-promise await is a no-op).
const _queue = [];

function describe(name, fn) {
  _queue.push({ type: 'describe', name });
  fn();
}

function it(name, fn) {
  _queue.push({ type: 'it', name, fn });
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

// Deep-ish array equality for test ergonomics. Used by analytics tests
// where we compare {date, count} series. Strict on shape + values.
function assertArrayEqual(actual, expected, msg) {
  const prefix = msg ? msg + ': ' : '';
  if (!Array.isArray(actual)) throw new Error(prefix + 'actual is not an array');
  if (!Array.isArray(expected)) throw new Error(prefix + 'expected is not an array');
  if (actual.length !== expected.length) {
    throw new Error(`${prefix}length mismatch: expected ${expected.length}, got ${actual.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (JSON.stringify(actual[i]) !== JSON.stringify(expected[i])) {
      throw new Error(`${prefix}index ${i}: expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`);
    }
  }
}

async function reportResults() {
  for (const entry of _queue) {
    if (entry.type === 'describe') {
      _output.push(`\n  ${entry.name}`);
      continue;
    }
    try {
      await entry.fn();
      _passed++;
      _output.push(`    ✓ ${entry.name}`);
    } catch (e) {
      _failed++;
      _output.push(`    ✗ ${entry.name} — ${e.message}`);
    }
  }

  const total = _passed + _failed;
  _output.push(`\n  ${total} tests: ${_passed} passed, ${_failed} failed`);

  const text = _output.join('\n');
  console.log(text);

  const el = document.getElementById('results');
  if (el) {
    el.textContent = text;
    el.style.color = _failed > 0 ? '#ff453a' : '#30d158';
  }

  document.title = _failed > 0 ? `FAIL (${_failed})` : `PASS (${_passed})`;
}
