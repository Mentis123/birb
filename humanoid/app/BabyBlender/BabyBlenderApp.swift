import SwiftUI

/// Baby Blender.
///
/// Opens straight into the editor on a lump of clay. There is no project picker
/// yet and should not be: Clay is the only template the app offers until the
/// humanoid layer lands, and a picker with one option is furniture.
@main
struct BabyBlenderApp: App {
    var body: some Scene {
        WindowGroup {
            EditorView()
        }
    }
}
