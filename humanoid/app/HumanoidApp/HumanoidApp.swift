import SwiftUI

/// Baby Blender.
///
/// The Phase 0 export check is still reachable — it is the only thing that
/// proves the device runs the same bytes CI verified — but the app opens on the
/// editor now.
@main
struct HumanoidApp: App {
    var body: some Scene {
        WindowGroup {
            EditorView()
        }
    }
}
