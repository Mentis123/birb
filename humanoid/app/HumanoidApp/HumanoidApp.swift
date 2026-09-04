import SwiftUI

/// Phase 0 app shell.
///
/// This is deliberately NOT the editor. Its only job is the M2 question: does the
/// export path actually run on a physical iPad? Everything below the UI is the
/// same package CI tests on Linux, so if the gate passes here and the exported
/// file matches the one CI produced, the device is running exactly the code that
/// was verified.
///
/// The Metal viewport, Pencil input and the sculpt tools arrive in Phase 2.
@main
struct HumanoidApp: App {
    var body: some Scene {
        WindowGroup {
            ExportCheckView()
        }
    }
}
