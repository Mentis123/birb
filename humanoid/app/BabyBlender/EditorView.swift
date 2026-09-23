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
                if editor.showStats { statsOverlay }
                Spacer()
                if let status = editor.status { toast(status) }
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

            Toggle(isOn: $editor.stabilise) {
                Image(systemName: "scribble.variable")
            }
            .toggleStyle(.button)
            .help("Steady the stroke")

            // Forces finger sculpting on. Usually unnecessary — until a Pencil
            // has been seen, a finger on the model already sculpts — but it is
            // the escape hatch for anyone who wants a finger to work while a
            // Pencil is paired, and it is visible rather than buried so nobody
            // has to guess why their finger only orbits.
            Toggle(isOn: $editor.fingerEditing) {
                Image(systemName: "hand.point.up.left")
            }
            .toggleStyle(.button)
            .help("Let a finger sculpt")

            Button { editor.frameModel() } label: { Image(systemName: "viewfinder") }

            // Pressure, hardness and latency, one tap away. Tuning the Pencil
            // is a feel decision that has to be made on the glass, so the
            // controls for it are in the app rather than in a build. The
            // Pencil's palette gestures open it too, which is why the flag
            // lives on the editor.
            Button { editor.showingBrushSettings = true } label: {
                Image(systemName: "pencil.tip.crop.circle")
            }
            .help("Brush and Pencil settings")
            .popover(isPresented: $editor.showingBrushSettings) { BrushSettingsView(editor: editor) }

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

    /// Three-finger tap toggles this.
    ///
    /// It exists because the honest answer to "does it hold 60 fps?" was "there
    /// is no way for you to know". A device report without numbers is an
    /// impression; this is the on-device counterpart of the build-box bench.
    private var statsOverlay: some View {
        Text(editor.hud)
            .font(.system(.caption2, design: .monospaced))
            .foregroundStyle(.white.opacity(0.85))
            .padding(8)
            .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 18)
    }

    /// A line the editor can put on screen for a couple of seconds. Used for
    /// the things that are otherwise indistinguishable from a broken tool —
    /// "Paint is still warming up" being the one that prompted it.
    private func toast(_ message: String) -> some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Color.black.opacity(0.62), in: Capsule())
            .padding(.bottom, 10)
            .transition(.opacity)
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
                // Size is in SCREEN points, converted to metres at whatever
                // depth the brush lands on. A brush fixed in world units is the
                // right size at exactly one zoom.
                labelled("Size") {
                    Slider(value: $editor.radiusPoints, in: 8...140)
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

            // Who does what, in one line.
            //
            // It exists because of the second device run: "none of the pencil
            // actions seems to work" and "I was using a finger, and fingers
            // move the camera" produce exactly the same experience, and there
            // was nothing on screen to tell them apart.
            Text(editor.inputHint)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.45))
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

/// Everything about how the Pencil drives the brush.
///
/// Pressure is the one setting a person has to tune with their own hand, and
/// before this it could not be tuned at all: it changed strength only, never
/// size, from a floor fixed in the code.
struct BrushSettingsView: View {
    @ObservedObject var editor: EditorModel

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Pressure changes size", isOn: $editor.pressureSize)
                    if editor.pressureSize {
                        percentSlider("Lightest touch size", value: $editor.minimumSize, in: 0.05...1)
                    }
                    Toggle("Pressure changes strength", isOn: $editor.pressureStrength)
                    if editor.pressureStrength {
                        percentSlider("Lightest touch strength", value: $editor.minimumStrength,
                                      in: 0.05...1)
                    }
                    Picker("Curve", selection: $editor.pressureCurve) {
                        ForEach(PressureResponse.Curve.allCases) { curve in
                            Text(curve.rawValue).tag(curve)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Apple Pencil pressure")
                } footer: {
                    Text("Soft makes a light touch count for more. The inner ring around the brush "
                         + "shows the lightest-touch size. Grab always moves exactly with the "
                         + "Pencil; pressure never changes it.")
                }

                Section {
                    percentSlider("Edge hardness", value: $editor.hardness, in: 0...0.9)
                } header: {
                    Text("Paint")
                } footer: {
                    Text("How much of the brush paints solid colour before the soft edge.")
                }

                Section {
                    Toggle("Mirror across the middle", isOn: $editor.symmetric)
                    Toggle("Steady stroke (lazy rope)", isOn: $editor.stabilise)
                    Toggle("Size fixed on the model", isOn: $editor.lockWorldSize)
                } header: {
                    Text("Brush")
                } footer: {
                    Text("Mirroring applies to painting as well as sculpting.")
                }

                Section {
                    Toggle("Low-latency drawing", isOn: $editor.lowLatency)
                    HStack {
                        Text("Drawing through")
                        Spacer()
                        Text(editor.loopDescription).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Latency")
                } footer: {
                    Text("iPadOS 18 or later: the Pencil's samples arrive later in each frame and "
                         + "the frame is shown as soon as it is ready. Tap with three fingers to "
                         + "see the measured touch-to-glass time, and compare.")
                }
            }
            .navigationTitle("Brush & Pencil")
            .navigationBarTitleDisplayMode(.inline)
        }
        .frame(minWidth: 380, minHeight: 560)
    }

    private func percentSlider(_ title: String, value: Binding<Double>,
                               in range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int((value.wrappedValue * 100).rounded()))%")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range)
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
