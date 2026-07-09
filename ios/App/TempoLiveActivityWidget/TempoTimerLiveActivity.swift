// TempoTimerLiveActivity — SwiftUI Live Activity views for Tempo's Timer.
//
// Three surfaces, all driven by the same TempoTimerAttributes / ContentState:
//   1. Lock-screen view — large countdown text + thin progress bar at the
//      bottom (Q1 → Option B). Name + PAUSED badge in top row.
//   2. Dynamic Island (iPhone 14 Pro+) compact / expanded / minimal layouts.
//   3. The expanded view carries `.widgetURL(URL(string: "tempo://timers/timer"))`
//      so tapping it routes through the registered URL scheme to the JS-side
//      appUrlOpen listener (in js/tempo-nav.js — wired in Phase 4).
//
// Apple's Text(timerInterval:countsDown:) and ProgressView(timerInterval:)
// re-render at OS cadence (~1 Hz on lock screen) without any per-tick
// push from the app. When `isPaused == true`, the live views are swapped
// for static text + a frozen progress bar to avoid the snap-back delta
// the brief's Q5 flagged.

import SwiftUI
import WidgetKit
import ActivityKit

@available(iOS 16.1, *)
struct TempoTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TempoTimerAttributes.self) { context in
            // Lock-screen / banner view.
            TempoTimerLockScreenView(context: context)
                .widgetURL(URL(string: "tempo://timers/timer"))
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded — pulls down when long-pressed (or when the
                // activity wants to surface for visibility events).
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer")
                        .foregroundColor(.green)
                        .imageScale(.medium)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.isPaused {
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
                    Text(context.attributes.timerName)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TempoTimerProgressBar(state: context.state)
                        .padding(.horizontal, 6)
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundColor(.green)
                    .imageScale(.small)
            } compactTrailing: {
                if context.state.isPaused {
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
                if context.state.isPaused {
                    Image(systemName: "pause.fill")
                        .foregroundColor(.orange)
                } else {
                    Text(timerInterval: Date()...context.state.endsAt,
                         countsDown: true)
                        .font(.caption2.monospacedDigit())
                        .foregroundColor(.green)
                }
            }
            .widgetURL(URL(string: "tempo://timers/timer"))
            .keylineTint(.green)
        }
    }
}

// MARK: - Lock-screen view

@available(iOS 16.1, *)
struct TempoTimerLockScreenView: View {
    let context: ActivityViewContext<TempoTimerAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Top row: glyph + name (leading), PAUSED badge (trailing).
            HStack(spacing: 8) {
                Image(systemName: "timer")
                    .foregroundColor(.green)
                    .imageScale(.medium)
                Text(context.attributes.timerName)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
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

            // Center: large countdown. Static when paused, live otherwise.
            HStack {
                Spacer()
                if context.state.isPaused {
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
            TempoTimerProgressBar(state: context.state)
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

    var body: some View {
        if state.isPaused {
            // Static bar — captures the current progress fraction and
            // freezes there.
            ProgressView(value: pausedFraction())
                .progressViewStyle(.linear)
                .tint(.green)
        } else {
            // Live bar — Apple drives the fill at OS cadence based on the
            // interval, no JS push needed.
            ProgressView(timerInterval: state.startedAt...state.endsAt,
                         countsDown: false)
                .progressViewStyle(.linear)
                .tint(.green)
        }
    }

    private func pausedFraction() -> Double {
        let total = state.endsAt.timeIntervalSince(state.startedAt)
        guard total > 0 else { return 0 }
        let elapsed = Date().timeIntervalSince(state.startedAt)
        return max(0, min(1, elapsed / total))
    }
}
