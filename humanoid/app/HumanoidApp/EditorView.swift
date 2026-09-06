import SwiftUI
import HumanoidCore

/// The editor screen: viewport, tool rail, and the settings that matter.
///
/// Chrome is kept to the edges. On a sculpting tool the model is the interface,
/// and every control on top of it is a control you have to drag around.
struct EditorView: View {
    @StateObject private var editor = EditorModel()
    @State private var showingExport = false

    private static let ground = Color(red: 0.024, green: 0.035, blue: 0.094)
    private static let panel = Color(red: 0.039, green: 0.075, blue: 0.141)
    private static let accent = Color(red: 0.302, green: 0.941, blue: 1.0)

    var body: some View {
        ZStack {
            SculptView(editor: editor)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Spacer()
                bottomBar
            }
        }
        .background(Self.ground)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showingExport) { ExportSheet(editor: editor) }
    }

    private var topBar: some View {
        HStack(spacing: 14) {
            Text("Baby Blender")
                .font(.headline)
                .foregroundStyle(.white)

            Spacer()

            Button { editor.undo() } label: { Image(systemName: "arrow.uturn.backward") }
                .disabled(!editor.canUndo)
            Button { editor.redo() } label: { Image(systemName: "arrow.uturn.forward") }
                .disabled(!editor.canRedo)

            Toggle(isOn: $editor.symmetric) {
                Image(systemName: "circle.lefthalf.filled")
            }
            .toggleStyle(.button)
            .help("Mirror every stroke")

            Button { editor.frameModel() } label: { Image(systemName: "viewfinder") }

            Button { showingExport = true } label: {
                Text("Export").fontWeight(.semibold)
            }
            .buttonStyle(.borderedProminent)
            .tint(Self.accent)
            .foregroundStyle(Self.ground)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .tint(Self.accent)
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                ForEach(EditorModel.Tool.allCases) { tool in
                    Button {
                        editor.tool = tool
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: tool.symbol).font(.system(size: 17))
                            Text(tool.rawValue).font(.caption2)
                        }
                        .frame(width: 62, height: 46)
                        .background(editor.tool == tool ? Self.accent.opacity(0.22) : .clear)
                        .overlay(
                            RoundedRectangle(cornerRadius: 9)
                                .stroke(editor.tool == tool ? Self.accent : .white.opacity(0.12))
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    }
                    .foregroundStyle(editor.tool == tool ? Self.accent : .white.opacity(0.75))
                }
            }

            HStack(spacing: 18) {
                labelled("Size") {
                    Slider(value: $editor.radius, in: 0.005...0.12)
                }
                labelled("Strength") {
                    Slider(value: $editor.strength, in: 0.05...1.0)
                }
                if editor.tool.isPaint {
                    ColorPicker("", selection: $editor.colour, supportsOpacity: false)
                        .labelsHidden()
                        .frame(width: 40)
                    Button("Fill") { editor.fill() }
                        .buttonStyle(.bordered)
                }
            }
            .frame(maxWidth: 560)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .tint(Self.accent)
    }

    private func labelled<Content: View>(_ title: String,
                                         @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.white.opacity(0.55))
            content()
        }
    }
}

/// The pre-flight, surfaced.
///
/// This is the differentiator, so it is a screen rather than a toast: every
/// other route to a game-ready model tells you it is broken twenty minutes
/// later, inside an engine.
struct ExportSheet: View {
    @ObservedObject var editor: EditorModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = "Untitled"
    @State private var report: Gate.Report?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                }

                Section("Checks") {
                    let mesh = editor.document.mesh
                    row("Triangles", "\(mesh.triangleCount) / 10,000",
                        ok: mesh.triangleCount <= 10_000)
                    row("Vertices", "\(mesh.vertexCount)", ok: true)
                    row("Materials", "1", ok: true)
                    if let skeleton = editor.document.skeleton {
                        row("Bones", "\(skeleton.count)", ok: true)
                    }
                    if let report {
                        ForEach(Array(report.findings.enumerated()), id: \.offset) { _, finding in
                            Label(finding.message,
                                  systemImage: finding.severity == .error
                                      ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                                .foregroundStyle(finding.severity == .error ? .red : .yellow)
                                .font(.footnote)
                        }
                        if report.findings.isEmpty {
                            Label("No problems found", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                        }
                    }
                }

                Section {
                    Button("Run pre-flight") { report = editor.export(named: name) }
                    Button("Export Model") { dismiss() }
                        .disabled(report?.passes != true)
                } footer: {
                    Text(editor.document.skeleton == nil
                         ? "Exports a static mesh any engine can open."
                         : "Exports an avatar Unity maps as a Humanoid.")
                }
            }
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .onAppear { report = editor.export(named: name) }
    }

    private func row(_ title: String, _ value: String, ok: Bool) -> some View {
        HStack {
            Image(systemName: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(ok ? .green : .red)
            Text(title)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }
}
