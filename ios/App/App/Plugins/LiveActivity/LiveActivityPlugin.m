// LiveActivityPlugin registration lives in Swift (Capacitor 6).
//
// Capacitor 6.x discovers plugins via the Swift CAPBridgedPlugin protocol
// (see LiveActivityPlugin.swift: identifier / jsName / pluginMethods), scanned
// at bridge init. The legacy Obj-C CAP_PLUGIN macro is intentionally omitted:
// the 6.x bridge does not enumerate macro-only registrations (so it would do
// nothing), and it would collide with the Swift class's identifier/jsName/
// pluginMethods on the same Obj-C selectors. This file is retained only so the
// existing Xcode build reference stays valid; it registers nothing.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>
