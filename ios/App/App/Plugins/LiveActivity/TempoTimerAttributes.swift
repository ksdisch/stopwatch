// TempoTimerAttributes — shared ActivityAttributes for the Timer Live Activity.
//
// This file must have target membership in BOTH the main App target AND the
// new TempoLiveActivityWidget target. The plugin (in App) calls
//   Activity<TempoTimerAttributes>.request(...)
// and the widget (in TempoLiveActivityWidget) renders
//   ActivityViewContext<TempoTimerAttributes>.state
// Both sides need this struct visible at compile time.
//
// Wrapped in `if canImport(ActivityKit)` so older iOS (15.x / 16.0) compile
// paths in the main App target degrade cleanly. The struct is only ever
// referenced inside `if #available(iOS 16.1, *)` blocks, so runtime
// availability is the load-bearing gate.

import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct TempoTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Absolute start time — used by ProgressView(timerInterval:) for
        // OS-rendered progress bar updates.
        var startedAt: Date
        // Absolute end time — used by Text(timerInterval:) for OS-rendered
        // countdown updates. Apple's local rendering loop reads this date
        // and ticks down ~1 Hz on lock screen without any per-tick push.
        var endsAt: Date
        // When true, the widget swaps the live `Text(timerInterval:)` for a
        // static `Text` of the remaining duration and the live `ProgressView`
        // for a static `ProgressView(value:)`. Avoids the snap-back where
        // the live view keeps ticking 0–1s after the user hits Pause.
        var isPaused: Bool
        // Updatable phase label for multi-phase engines ("Work 2/4",
        // "Break", "Focus", "Recovery"). Lives in ContentState — NOT the
        // fixed attributes — because one continuous activity spans a whole
        // Pomodoro/Flow session and the label changes at each phase
        // boundary. Optional so payloads from the Timer engine (and
        // in-flight activities from builds predating this field) decode as
        // nil and render exactly as before.
        var label: String?
    }

    // Stable id matching Timer.id (e.g. "tm-default"). Used by the plugin
    // to look up the existing activity in its [String: Activity<...>] dict
    // so resume-from-pause routes to .update(...) not a duplicate .request(...).
    var timerId: String
    // User-facing label (e.g. "Tea steep", "Focus break"). Persists for the
    // life of the activity — re-pausing does NOT mutate this.
    var timerName: String
    // Engine key ("pomodoro" | "flow"; nil = plain timer). Fixed for the
    // activity's lifetime — an activity never changes engines — and drives
    // the widget's glyph, tint, and per-mode deep-link. Optional for decode
    // compat with pre-field activities; unknown values fall back to the
    // Timer presentation.
    var mode: String?
}
#endif
