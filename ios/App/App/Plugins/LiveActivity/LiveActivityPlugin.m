// LiveActivityPlugin Obj-C bridge — Capacitor plugin registration.
//
// The CAP_PLUGIN macro tells Capacitor's runtime which @objc-exposed Swift
// methods to wire to JS. The SECOND string ("LiveActivity") is what makes
// window.Capacitor.Plugins.LiveActivity populate at runtime — it MUST match
// the JS-side lookup in js/platform.js verbatim. A typo here silently
// leaves the plugin handle undefined on the JS side, with no Xcode warning
// and no runtime error.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LiveActivityPlugin, "LiveActivity",
    CAP_PLUGIN_METHOD(isSupported,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startTimer,   CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(updateTimer,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(endTimer,     CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(endAll,       CAPPluginReturnPromise);
)
