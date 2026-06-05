---
name: match-the-mock
description: Implement a UI against a visual target and iterate until it matches — implement, screenshot the running app with a browser tool, compare to the mock, fix the diffs, repeat. Use when the user provides a mock / design / screenshot (or a Figma link) and asks to build, match, or pixel-tune a UI to it, or says "make it look like this". The auto-triggering sibling of the /screenshot-iterate command.
---

# Match the mock

Take a visual target (a mock image, screenshot, or design) and drive a UI to match
it using a **see-and-correct loop**: implement → screenshot the running app →
compare to the target → fix the diffs → repeat.

This is the same workflow as the `/screenshot-iterate` slash command, packaged as a
skill so it fires automatically when Kyle hands over a design to match — he doesn't
have to remember to invoke it.

## When this skill fires

- Kyle provides a mock / design / screenshot and asks to build or match it
  ("make it look like this", "implement this design", "match this mock").
- Kyle asks to pixel-tune or visually polish an existing screen against a reference.
- He drops a Figma link or an image and describes a UI to produce.

## When NOT to use it

- No visual target and none obtainable → this loop has nothing to check against;
  just build normally.
- The gap is behavioral/logical, not visual → use the test-first loop instead.
- "Is it fun / does it feel right" judgments → that's a human playtest, not a
  screenshot diff.

## The loop

### 1. Lock the target
Look at the provided image. Enumerate the concrete, checkable attributes you'll
iterate on: layout & alignment, spacing, colors, typography, component states.
If no image is available, ask for one or a precise description before writing code.

### 2. Get eyes on the running app
- Make sure the dev server is running and you know the exact URL/route for the view
  in question. Start it if needed.
- Make sure a browser tool is available to navigate + capture (Playwright /
  Puppeteer-style MCP, or equivalent). If not, say what to enable rather than
  iterating blind.

### 3. Implement → screenshot → compare → iterate
- Build a first pass.
- Navigate, screenshot the target view, and **actually read the screenshot**
  against the mock.
- Write down the specific diffs ("CTA is ~16px too low", "panel bg too light").
  Vague "looks close" is not allowed — name the deltas.
- Fix the largest diffs first, then re-screenshot. Loop until it matches or you hit
  something that needs Kyle's taste call.
- Keep it cheap: screenshot only the relevant viewport/region, aim to converge in
  ~3–5 iterations, and drop a screenshot from context once you've pulled the diffs
  from it.

### 4. Close out
- Show the final screenshot beside the mock so Kyle can sign off.
- Commit when he's happy (conventional commit). Don't push unless told.

## Project notes (Constellation only — ignore elsewhere)

- Two front-ends to point at: the Phaser game (`index.html`, dev server on :5180)
  and the React phone client (`phone.html`). Pick the right URL/route for the view.
- Honor the project's visual rules when matching: phone uses inline `style={{}}`
  only, the cold palette (panels `#1a1b3a`, accent `#7ad8ff`, error `#ff6b9d`), and
  ≥44px touch targets. Match the mock *within* those constraints; if the mock
  contradicts them, flag it rather than violating the conventions.

## Why this is a skill (the teaching bit)

The `/screenshot-iterate` command and this skill do the same thing — the difference
is the *trigger*:

- **Command**: you fire it deliberately by typing `/screenshot-iterate`. Full
  control; nothing happens unless you ask.
- **Skill**: Claude fires it automatically when your request matches the
  `description` above (e.g. you paste a mock and say "build this"). Less to
  remember, but it acts on its own judgment.

Same prompt body, different ignition. If you find you always type the command
anyway, the skill is redundant. If you keep wishing Claude "just knew" to do this
whenever you share a design, the skill earns its keep.
