import SwiftUI
import os

/// Baby Blender.
///
/// Opens straight into the editor on a lump of clay. There is no project picker
/// yet and should not be: Clay is the only template the app offers until the
/// humanoid layer lands, and a picker with one option is furniture.
@main
struct BabyBlenderApp: App {
    init() {
        // Milestones, so a launch that stalls says where. Everything before the
        // first frame runs on the main thread, and a black screen gives no clue
        // which step it is sitting in.
        NSLog("[BabyBlender] launched")
    }

    var body: some Scene {
        WindowGroup {
            EditorView()
        }
    }
}
