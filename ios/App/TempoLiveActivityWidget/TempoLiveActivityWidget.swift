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
        // One shared activity type serves every countdown-shaped engine
        // (Timer, Pomodoro, Flow) via TempoTimerAttributes' optional
        // `mode`/`label` fields — NOT one ActivityAttributes struct per
        // engine, because the plugin's lifecycle paths (endAll, registry
        // re-adoption) are typed on a single Activity<T>. Count-up engines
        // (Stopwatch) will need a genuinely different ContentState and can
        // add a sibling widget here when they ship.
        if #available(iOS 16.1, *) {
            TempoTimerLiveActivity()
        }
    }
}
