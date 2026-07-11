// TempoTimerLiveActivity — SwiftUI Live Activity views for Tempo's Timer.
//
// Three surfaces, all driven by the same TempoTimerAttributes / ContentState:
//   1. Lock-screen view — large countdown text + thin progress bar at the
//      bottom (Q1 → Option B). Name + PAUSED badge in top row.
//   2. Dynamic Island (iPhone 14 Pro+) compact / expanded / minimal layouts.
//   3. The expanded view carries `.widgetURL(URL(string: "tempo://timers/countdown"))`
//      so tapping it routes through the registered URL scheme to the JS-side
//      appUrlOpen listener (in js/tempo-nav.js — wired in Phase 4).
//      'countdown' is the canonical Timers sub-route in TIMERS_MODES; the JS
//      also aliases 'timer' for activities started by older builds.
//
// Apple's Text(timerInterval:countsDown:) and ProgressView(timerInterval:)
// re-render at OS cadence (~1 Hz on lock screen) without any per-tick
// push from the app. When `isPaused == true`, the live views are swapped
// for static text + a frozen progress bar to avoid the snap-back delta
// the brief's Q5 flagged.

import SwiftUI
import WidgetKit
import ActivityKit

// True once the countdown has run out. The app is usually suspended at that
// moment — no JS can run — so the widget itself must flip to the "Done"
// state until the app's next resume ends the activity. Two triggers, because
// the system coalesces stale re-renders (on device the 0:00 render arrived
// with isStale still false): the staleDate transition when it comes, and any
// other re-render (update, lock/unlock) that happens after endsAt. A paused
// activity is never "done" — its endsAt stops meaning anything the moment
// isPaused flips true.
@available(iOS 16.1, *)
private func isDone(_ context: ActivityViewContext<TempoTimerAttributes>) -> Bool {
    if context.state.isPaused { return false }
    if #available(iOS 16.2, *), context.isStale { return true }
    return context.state.endsAt <= Date()
}

// Per-engine presentation. One widget serves every engine: the shared
// attributes carry an optional `mode` ("pomodoro" | "flow"; nil = plain
// timer) and glyph / tint / deep-link derive from it. Unknown or absent
// modes MUST fall back to the shipped Timer look so in-flight activities
// from older builds (which decode mode as nil) render pixel-identical.
private func modeGlyph(_ mode: String?) -> String {
    switch mode {
    case "pomodoro": return "repeat.circle"
    case "flow":     return "brain.head.profile"
    default:         return "timer"
    }
}

private func modeTint(_ mode: String?) -> Color {
    switch mode {
    case "pomodoro": return .red
    case "flow":     return .indigo
    default:         return .green
    }
}

// Deep-link target per engine. The route keys are TIMERS_MODES entries in
// js/tempo-nav.js — the generic tempo://<host>/<path> → #/<host>/<path>
// mapping needs no JS-side changes for these.
private func modeURL(_ mode: String?) -> URL? {
    switch mode {
    case "pomodoro": return URL(string: "tempo://timers/pomodoro")
    case "flow":     return URL(string: "tempo://timers/flow")
    default:         return URL(string: "tempo://timers/countdown")
    }
}

@available(iOS 16.1, *)
struct TempoTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TempoTimerAttributes.self) { context in
            // Lock-screen / banner view.
            TempoTimerLockScreenView(context: context)
                .widgetURL(modeURL(context.attributes.mode))
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded — pulls down when long-pressed (or when the
                // activity wants to surface for visibility events).
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: modeGlyph(context.attributes.mode))
                        .foregroundColor(modeTint(context.attributes.mode))
                        .imageScale(.medium)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if isDone(context) {
                        Text("DONE")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.green)
                    } else if context.state.isPaused {
                        Text("PAUSED")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.orange)
                    } else {
                        Text(timerInterval: Date()...context.state.endsAt,
                             countsDown: true)
                            .font(.title3.monospacedDigit())
                            .foregroundColor(.primary)
                            .multilineTextAlignment(.trailing)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.attributes.timerName)
                            .font(.headline)
                            .lineLimit(1)
                        if let label = context.state.label, !label.isEmpty {
                            Text(label)
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TempoTimerProgressBar(state: context.state,
                                          tint: modeTint(context.attributes.mode))
                        .padding(.horizontal, 6)
                }
            } compactLeading: {
                Image(systemName: modeGlyph(context.attributes.mode))
                    .foregroundColor(modeTint(context.attributes.mode))
                    .imageScale(.small)
            } compactTrailing: {
                if isDone(context) {
                    Text("DONE")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.green)
                } else if context.state.isPaused {
                    Text("PAUSED")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.orange)
                } else {
                    Text(timerInterval: Date()...context.state.endsAt,
                         countsDown: true)
                        .font(.caption.monospacedDigit())
                        .foregroundColor(.primary)
                }
            } minimal: {
                // Minimal — shown when multiple activities are active and
                // the system collapses to a tiny indicator. Countdown only.
                if isDone(context) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                } else if context.state.isPaused {
                    Image(systemName: "pause.fill")
                        .foregroundColor(.orange)
                } else {
                    Text(timerInterval: Date()...context.state.endsAt,
                         countsDown: true)
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(modeTint(context.attributes.mode))
                }
            }
            .widgetURL(modeURL(context.attributes.mode))
            .keylineTint(modeTint(context.attributes.mode))
        }
    }
}

// MARK: - Lock-screen view

@available(iOS 16.1, *)
struct TempoTimerLockScreenView: View {
    let context: ActivityViewContext<TempoTimerAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Top row: glyph + name + phase label (leading), PAUSED badge
            // (trailing).
            HStack(spacing: 8) {
                Image(systemName: modeGlyph(context.attributes.mode))
                    .foregroundColor(modeTint(context.attributes.mode))
                    .imageScale(.medium)
                Text(context.attributes.timerName)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
                if let label = context.state.label, !label.isEmpty {
                    Text(label)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if context.state.isPaused {
                    Text("PAUSED")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.orange)
                        .cornerRadius(4)
                }
            }

            // Center: large countdown. "Done" once stale, static when
            // paused, live otherwise.
            HStack {
                Spacer()
                if isDone(context) {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .imageScale(.large)
                        Text("Done")
                            .font(.system(size: 42, weight: .semibold, design: .monospaced))
                            .foregroundColor(.primary)
                    }
                } else if context.state.isPaused {
                    Text(staticRemainingString(state: context.state))
                        .font(.system(size: 42, weight: .semibold, design: .monospaced))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                } else {
                    Text(timerInterval: Date()...context.state.endsAt,
                         countsDown: true)
                        .font(.system(size: 42, weight: .semibold, design: .monospaced))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .multilineTextAlignment(.center)
                }
                Spacer()
            }

            // Bottom: progress bar.
            TempoTimerProgressBar(state: context.state,
                                  tint: modeTint(context.attributes.mode))
        }
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.4))
        .activitySystemActionForegroundColor(Color.white)
    }

    // Static remaining-time string for the paused state. Format mirrors
    // `Text(timerInterval:countsDown:)`'s mm:ss / h:mm:ss output.
    private func staticRemainingString(state: TempoTimerAttributes.ContentState) -> String {
        let remaining = max(0, state.endsAt.timeIntervalSince(Date()))
        let total = Int(remaining.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Progress bar component

@available(iOS 16.1, *)
struct TempoTimerProgressBar: View {
    let state: TempoTimerAttributes.ContentState
    let tint: Color

    var body: some View {
        if state.isPaused {
            // Static bar — captures the current progress fraction and
            // freezes there.
            ProgressView(value: pausedFraction())
                .progressViewStyle(.linear)
                .tint(tint)
        } else {
            // Live bar — Apple drives the fill at OS cadence based on the
            // interval, no JS push needed. Both labels are suppressed: the
            // default currentValueLabel counts elapsed-in-window, and every
            // resume re-emits a window of just the remaining time, so it
            // clamps at a misleading number (0:33 / 0:46 on device).
            ProgressView(timerInterval: state.startedAt...state.endsAt,
                         countsDown: false,
                         label: { EmptyView() },
                         currentValueLabel: { EmptyView() })
                .progressViewStyle(.linear)
                .tint(tint)
        }
    }

    private func pausedFraction() -> Double {
        let total = state.endsAt.timeIntervalSince(state.startedAt)
        guard total > 0 else { return 0 }
        let elapsed = Date().timeIntervalSince(state.startedAt)
        return max(0, min(1, elapsed / total))
    }
}
