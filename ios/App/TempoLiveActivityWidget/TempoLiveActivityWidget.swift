// TempoLiveActivityWidget — Widget Extension bundle entry point.
//
// The Widget Extension is a separate iOS target (deployment target 16.1).
// Apple requires every Live Activity surface to live inside a Widget
// Extension because activities are rendered out-of-process by the system,
// not by the host app's WebView. The host app calls Activity.request(...)
// from the plugin (LiveActivityPlugin.swift), and the system spins up THIS
// extension to render the SwiftUI views in TempoTimerLiveActivity.swift.

import SwiftUI
import WidgetKit

@main
struct TempoLiveActivityWidget: WidgetBundle {
    var body: some Widget {
        // Single activity in MVP — Stopwatch / Pomodoro / Flow / Interval /
        // Cooking layouts are deferred to follow-up PRs. Each will add a
        // new ActivityAttributes struct + a sibling `TempoXxxLiveActivity`
        // here, then ship as its own Widget body item in this bundle.
        if #available(iOS 16.1, *) {
            TempoTimerLiveActivity()
        }
    }
}
