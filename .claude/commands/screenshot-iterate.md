---
description: Visual loop — implement against a mock, screenshot the running app with a browser tool, compare, and iterate until it matches. Pass the mock image (e.g. @mock.png) plus what to build as the argument.
argument-hint: <@mock.png + what to implement>
---

Task: $ARGUMENTS

Run the **write code → screenshot → iterate** loop until the result matches the
visual target. The whole point is to give yourself eyes: don't iterate blind.

## 1. Lock the target
- Look at the mock/reference image provided above. Note the specific things you'll
  be judged on: layout & alignment, spacing, colors, typography, component states.
- If no image was given, ask me for one (or a precise visual description) before
  writing any code.

## 2. Get eyes on the running app
- Confirm the dev server is up and you know the exact URL/route for the view in
  question. Start it if needed.
- Confirm a browser tool is available to navigate + screenshot (Playwright /
  Puppeteer-style MCP, or equivalent). If not, tell me what to enable rather than
  guessing blind.

## 3. Implement → screenshot → compare → iterate
- Implement a first pass.
- Navigate to the URL, screenshot the relevant view, and **actually look at the
  screenshot** next to the mock.
- Write down the concrete diffs you see ("header is ~16px too low", "accent color
  too saturated"). Vague "looks close" is not allowed — name the deltas.
- Fix the top diffs and repeat. Keep looping until it matches the mock or you hit
  a point that needs my taste call.
- Keep it cheap: screenshot only the relevant viewport/region (not the whole page),
  aim to converge in ~3–5 iterations, and once you've extracted the diffs from a
  screenshot don't keep it in context.

## 4. Wrap up
- Show me the final screenshot beside the mock.
- Commit when I'm happy (conventional-commit message). Don't push unless I say so.
