import SwiftUI
import UIKit
import CryptoKit
import HumanoidCore
import ExporterVRM
import ExporterFBX

/// Runs the whole export path on the device and shows what happened.
///
/// The SHA-256 line is the point of the screen: CI records the hash of the file
/// it built from the same snapshot, so a match proves the iPad produced
/// byte-identical output from byte-identical inputs. A mismatch means something
/// differs between the platforms — floating point, JSON key order, a compression
/// level — and that is worth knowing before any of it is trusted.
struct ExportCheckView: View {
    @State private var status: Status = .idle
    @State private var shareURLs: [URL] = []
    @State private var showShare = false

    enum Status {
        case idle
        case working
        case done(Summary)
        case failed(String)
    }

    struct Summary {
        var gate: String
        var gatePassed: Bool
        var triangles: Int
        var vertices: Int
        var bones: Int
        var vrmBytes: Int
        var vrmHash: String
        var fbxBytes: Int
        var fbxHash: String
        var fbxReopen: String
        var fbxReopenPassed: Bool
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    switch status {
                    case .idle:
                        Text("Runs the rig gate, writes a VRM and an FBX, and reopens the FBX with ufbx — the same checks CI runs on Linux.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    case .working:
                        HStack { ProgressView(); Text("Exporting…").padding(.leading, 8) }
                    case .failed(let message):
                        Label(message, systemImage: "xmark.octagon.fill")
                            .foregroundStyle(.red)
                    case .done(let summary):
                        resultRows(summary)
                    }
                }

                Section {
                    Button {
                        run()
                    } label: {
                        Label("Run export check", systemImage: "play.fill")
                    }
                    .disabled(isWorking)

                    Button {
                        showShare = true
                    } label: {
                        Label("Share exported files", systemImage: "square.and.arrow.up")
                    }
                    .disabled(shareURLs.isEmpty)
                } footer: {
                    Text("Share the files to your Mac to run the Unity session. See docs/Import_into_Unity.md.")
                }
            }
            .navigationTitle("Humanoid export")
            .sheet(isPresented: $showShare) { ShareSheet(items: shareURLs) }
        }
    }

    private var isWorking: Bool {
        if case .working = status { return true }
        return false
    }

    @ViewBuilder
    private func resultRows(_ s: Summary) -> some View {
        Label(s.gatePassed ? "Rig gate passed" : "Rig gate FAILED",
              systemImage: s.gatePassed ? "checkmark.seal.fill" : "xmark.octagon.fill")
            .foregroundStyle(s.gatePassed ? .green : .red)
        if !s.gatePassed {
            Text(s.gate).font(.footnote.monospaced())
        }
        LabeledContent("Bones", value: "\(s.bones)")
        LabeledContent("Triangles", value: "\(s.triangles)")
        LabeledContent("Vertices", value: "\(s.vertices)")
        LabeledContent("VRM", value: "\(s.vrmBytes) bytes")
        LabeledContent("VRM SHA-256", value: String(s.vrmHash.prefix(16)) + "…")
            .font(.footnote.monospaced())
        LabeledContent("FBX", value: "\(s.fbxBytes) bytes")
        LabeledContent("FBX SHA-256", value: String(s.fbxHash.prefix(16)) + "…")
            .font(.footnote.monospaced())
        Label(s.fbxReopenPassed ? "FBX reopened and matches" : "FBX reopen FAILED",
              systemImage: s.fbxReopenPassed ? "checkmark.seal.fill" : "xmark.octagon.fill")
            .foregroundStyle(s.fbxReopenPassed ? .green : .red)
        Text(s.fbxReopen).font(.footnote.monospaced()).foregroundStyle(.secondary)
    }

    private func run() {
        status = .working
        shareURLs = []
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                // The shipped body, not the placeholder. The point of the device
                // check is that the file the iPad writes is byte-identical to the
                // one CI verified, and that only means something if it is the
                // same body a user would export.
                let template = try TemplateFile.bundled()
                let snapshot = ExportSnapshot(
                    avatarName: "DeviceCheck",
                    templateID: TemplateFile.bundledID,
                    templateVersion: TemplateFile.bundledVersion,
                    skeleton: template.skeleton,
                    mesh: template.mesh,
                    albedo: PNG.Image.solid(width: 512, height: 512, r: 214, g: 176, b: 150),
                    albedoRelativePath: "Textures/DeviceCheck_Albedo.png")
                let report = snapshot.validate()

                let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let vrmURL = directory.appendingPathComponent("DeviceCheck.vrm")
                let fbxURL = directory.appendingPathComponent("DeviceCheck.fbx")

                let vrmData = try VRMExporter.export(snapshot)
                try vrmData.write(to: vrmURL)
                try FBXExporter.export(snapshot, to: fbxURL)
                let fbxData = try Data(contentsOf: fbxURL)

                let reopen = FBXValidator.validate(fbxURL, against: snapshot)

                let summary = Summary(
                    gate: report.summary,
                    gatePassed: report.passes,
                    triangles: snapshot.mesh.triangleCount,
                    vertices: snapshot.mesh.vertexCount,
                    bones: snapshot.skeleton.count,
                    vrmBytes: vrmData.count,
                    vrmHash: sha256(vrmData),
                    fbxBytes: fbxData.count,
                    fbxHash: sha256(fbxData),
                    fbxReopen: reopen.summary,
                    fbxReopenPassed: reopen.passes)

                DispatchQueue.main.async {
                    shareURLs = [vrmURL, fbxURL]
                    status = .done(summary)
                }
            } catch {
                DispatchQueue.main.async { status = .failed("\(error)") }
            }
        }
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
