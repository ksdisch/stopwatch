// LiveActivityPlugin — JS↔ActivityKit bridge for Tempo's Timer Live Activities.
//
// JS-side calls land here via the CAP_PLUGIN macro in LiveActivityPlugin.m,
// which registers the plugin under the name "LiveActivity" — making it
// reachable from JS as window.Capacitor.Plugins.LiveActivity. The JS-side
// abstraction lives in js/platform.js (Platform.liveActivity).
//
// Plugin instance lifecycle: instantiated ONCE by Capacitor at WebView load
// and persists for the WebView lifetime. The private activities dictionary
// is therefore stable across pause→resume cycles by virtue of plugin
// singleton-ness — no extra persistence needed.
//
// iOS gating: every ActivityKit reference is wrapped in
//   if #available(iOS 16.1, *) { ... } else { call.resolve([...ok: false...]) }
// so the main App target's IPHONEOS_DEPLOYMENT_TARGET stays at 13.0.
// Older-iOS users see the JS shim resolve to { ok: false } silently — no
// crash, no error.

import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {

    // Capacitor 6 discovers plugins by CAPBridgedPlugin conformance
    // (identifier / jsName / pluginMethods) scanned at bridge init — the
    // legacy Obj-C CAP_PLUGIN macro is NOT enumerated by the 6.x bridge, so a
    // macro-only plugin never lands on window.Capacitor.Plugins. `jsName` MUST
    // match the JS lookup in js/platform.js (Platform.liveActivity →
    // window.Capacitor.Plugins.LiveActivity).
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise)
    ]

    // Keyed by `timerId`. On startTimer the plugin checks this dict and
    // either issues `.update(...)` on the existing handle (resume-from-pause)
    // or creates a fresh `Activity.request(...)` (first start). Type-erased
    // to `Any` so the property declaration itself doesn't need iOS 16.1
    // availability — the per-method casts handle that.
    private var activities: [String: Any] = [:]

    // Only .active/.stale activities are adoptable. A just-ended or user-
    // dismissed activity lingers in the dict and briefly in the registry;
    // adopting one makes startTimer "update" a corpse (a silent no-op)
    // instead of requesting a fresh activity — on device: toggle OFF
    // (endAll) → toggle ON → start rendered nothing. Stale stays adoptable
    // on purpose: the finished-while-locked "Done" activity must be findable
    // so endTimer can dismiss it on the next app resume.
    @available(iOS 16.1, *)
    private func isLive(_ activity: Activity<TempoTimerAttributes>) -> Bool {
        if activity.activityState == .active { return true }
        if #available(iOS 16.2, *), activity.activityState == .stale { return true }
        return false
    }

    // Dict lookup with a system-registry fallback. After a process relaunch
    // (force-quit, jetsam) the dict is empty but ActivityKit may still be
    // tracking activities from the previous launch — without the fallback,
    // startTimer would request a DUPLICATE and updateTimer/endTimer would
    // no-op against the orphan. Live matches are re-adopted into the dict;
    // dead dict entries are purged on sight.
    @available(iOS 16.1, *)
    private func findActivity(_ timerId: String) -> Activity<TempoTimerAttributes>? {
        if let existing = activities[timerId] as? Activity<TempoTimerAttributes> {
            if isLive(existing) { return existing }
            activities.removeValue(forKey: timerId)
        }
        if let orphan = Activity<TempoTimerAttributes>.activities
            .first(where: { $0.attributes.timerId == timerId && isLive($0) }) {
            activities[timerId] = orphan
            return orphan
        }
        return nil
    }

    // MARK: - isSupported

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
            call.resolve(["supported": enabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    // MARK: - startTimer

    @objc func startTimer(_ call: CAPPluginCall) {
        guard let timerId = call.getString("id") else {
            call.reject("Missing 'id'")
            return
        }
        let timerName = call.getString("name") ?? "Timer"
        // Optional phase metadata (Pomodoro/Flow): absent for plain timers.
        let label = call.getString("label")
        let mode  = call.getString("mode")
        // JS sends epoch-ms (Date.now()); convert to Date.
        let startedAtMs = call.getDouble("startedAt") ?? Double(Date().timeIntervalSince1970 * 1000.0)
        let endsAtMs   = call.getDouble("endsAt")   ?? startedAtMs
        let isPaused   = call.getBool("isPaused")   ?? false
        let startedAt  = Date(timeIntervalSince1970: startedAtMs / 1000.0)
        let endsAt     = Date(timeIntervalSince1970: endsAtMs / 1000.0)

        if #available(iOS 16.1, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["ok": false, "reason": "not-authorized"])
                return
            }

            let contentState = TempoTimerAttributes.ContentState(
                startedAt: startedAt,
                endsAt: endsAt,
                isPaused: isPaused,
                label: label
            )

            // staleDate = endsAt (16.2+): the app is suspended when a locked-
            // phone countdown hits zero, so no JS can end the activity at that
            // moment. Going stale at endsAt re-renders the widget, whose
            // isStale branch shows the "Done" state instead of a dead 0:00.
            // nil while paused — a long pause must not fake a "Done".
            let staleDate: Date? = isPaused ? nil : endsAt

            // Resume-from-pause: if an activity already exists for this
            // timerId (dict or system registry), update it in place rather
            // than creating a duplicate.
            if let existing = findActivity(timerId) {
                Task {
                    if #available(iOS 16.2, *) {
                        await existing.update(ActivityContent(state: contentState, staleDate: staleDate))
                    } else {
                        await existing.update(using: contentState)
                    }
                }
                call.resolve(["ok": true, "updated": true])
                return
            }

            // First start: request a brand-new activity.
            let attributes = TempoTimerAttributes(timerId: timerId, timerName: timerName, mode: mode)
            do {
                let activity: Activity<TempoTimerAttributes>
                if #available(iOS 16.2, *) {
                    activity = try Activity.request(
                        attributes: attributes,
                        content: ActivityContent(state: contentState, staleDate: staleDate),
                        pushType: nil
                    )
                } else {
                    activity = try Activity.request(
                        attributes: attributes,
                        contentState: contentState,
                        pushType: nil
                    )
                }
                activities[timerId] = activity
                call.resolve(["ok": true, "updated": false])
            } catch {
                call.resolve(["ok": false, "reason": "request-failed", "error": "\(error)"])
            }
        } else {
            call.resolve(["ok": false, "reason": "ios-version"])
        }
    }

    // MARK: - updateTimer

    @objc func updateTimer(_ call: CAPPluginCall) {
        guard let timerId = call.getString("id") else {
            call.reject("Missing 'id'")
            return
        }

        if #available(iOS 16.1, *) {
            guard let existing = findActivity(timerId) else {
                // Nothing to update — treat as a no-op success so JS callers
                // don't need to differentiate "no activity" from "update failed."
                call.resolve(["ok": true, "noop": true])
                return
            }

            // Merge: keep existing fields where the JS payload didn't specify.
            let currentState: TempoTimerAttributes.ContentState
            if #available(iOS 16.2, *) {
                currentState = existing.content.state
            } else {
                currentState = existing.contentState
            }
            let nextStartedAt: Date = {
                if let ms = call.getDouble("startedAt") {
                    return Date(timeIntervalSince1970: ms / 1000.0)
                }
                return currentState.startedAt
            }()
            let nextEndsAt: Date = {
                if let ms = call.getDouble("endsAt") {
                    return Date(timeIntervalSince1970: ms / 1000.0)
                }
                return currentState.endsAt
            }()
            let nextIsPaused = call.getBool("isPaused") ?? currentState.isPaused
            // Merge like the fields above: a payload without `label` keeps
            // the current one (phase labels only travel on phase changes).
            let nextLabel = call.getString("label") ?? currentState.label

            let nextState = TempoTimerAttributes.ContentState(
                startedAt: nextStartedAt,
                endsAt: nextEndsAt,
                isPaused: nextIsPaused,
                label: nextLabel
            )

            Task {
                if #available(iOS 16.2, *) {
                    // Same stale contract as startTimer: stale at endsAt while
                    // counting (drives the widget's "Done" state), never while
                    // paused.
                    await existing.update(ActivityContent(state: nextState, staleDate: nextIsPaused ? nil : nextEndsAt))
                } else {
                    await existing.update(using: nextState)
                }
            }
            call.resolve(["ok": true])
        } else {
            call.resolve(["ok": false, "reason": "ios-version"])
        }
    }

    // MARK: - endTimer

    @objc func endTimer(_ call: CAPPluginCall) {
        guard let timerId = call.getString("id") else {
            call.reject("Missing 'id'")
            return
        }

        if #available(iOS 16.1, *) {
            guard let existing = findActivity(timerId) else {
                call.resolve(["ok": true, "noop": true])
                return
            }
            // Capture final state so the lock-screen view doesn't flash a
            // stale countdown during the dismiss animation.
            let finalState: TempoTimerAttributes.ContentState
            if #available(iOS 16.2, *) {
                finalState = existing.content.state
            } else {
                finalState = existing.contentState
            }

            activities.removeValue(forKey: timerId)
            Task {
                if #available(iOS 16.2, *) {
                    await existing.end(
                        ActivityContent(state: finalState, staleDate: nil),
                        dismissalPolicy: .immediate
                    )
                } else {
                    await existing.end(using: finalState, dismissalPolicy: .immediate)
                }
            }
            call.resolve(["ok": true])
        } else {
            call.resolve(["ok": false, "reason": "ios-version"])
        }
    }

    // MARK: - endAll

    @objc func endAll(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            let snapshot = activities
            activities.removeAll()
            Task {
                for (_, value) in snapshot {
                    guard let activity = value as? Activity<TempoTimerAttributes> else { continue }
                    let finalState: TempoTimerAttributes.ContentState
                    if #available(iOS 16.2, *) {
                        finalState = activity.content.state
                    } else {
                        finalState = activity.contentState
                    }
                    if #available(iOS 16.2, *) {
                        await activity.end(
                            ActivityContent(state: finalState, staleDate: nil),
                            dismissalPolicy: .immediate
                        )
                    } else {
                        await activity.end(using: finalState, dismissalPolicy: .immediate)
                    }
                }
            }
            // Belt-and-suspenders: also kill any system-side activity the
            // plugin doesn't have a local handle for (e.g., from a previous
            // launch the plugin re-instance didn't pick up).
            if #available(iOS 16.2, *) {
                Task {
                    for activity in Activity<TempoTimerAttributes>.activities {
                        await activity.end(
                            ActivityContent(state: activity.content.state, staleDate: nil),
                            dismissalPolicy: .immediate
                        )
                    }
                }
            }
            call.resolve(["ok": true])
        } else {
            call.resolve(["ok": false, "reason": "ios-version"])
        }
    }
}
