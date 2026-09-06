import Foundation

/// Shared vocabulary for the pre-flight gates.
///
/// There are two, and which of them runs is the one thing that differs between
/// a Clay document and a Humanoid one:
///
/// - `MeshGate` checks the geometry every document has — finite numbers, index
///   bounds, matching array lengths, real triangles, a UV set.
/// - `RigGate` checks the skeleton, and only a Humanoid document has one.
///
/// A Clay document is not "missing bones". Reporting one as a rig failure would
/// put permanent red in a panel that is supposed to mean something, and a panel
/// that always shows an error is a panel people stop reading. So the gates are
/// separate types rather than one gate with the rig half switched off.
public enum Gate {
    public enum Severity: String, Sendable, Codable { case error, warning }

    public struct Finding: Sendable, Codable, CustomStringConvertible {
        public let severity: Severity
        public let code: String
        public let message: String
        /// The system whose rule this reproduces, so a failure points at the
        /// right documentation when it needs re-checking.
        public let source: String

        public init(severity: Severity, code: String, message: String, source: String) {
            self.severity = severity
            self.code = code
            self.message = message
            self.source = source
        }

        public var description: String { "[\(severity.rawValue)] \(code): \(message) (\(source))" }
    }

    public struct Report: Sendable, Codable {
        public let label: String
        public let findings: [Finding]

        public init(label: String, findings: [Finding]) {
            self.label = label
            self.findings = findings
        }

        public var errors: [Finding] { findings.filter { $0.severity == .error } }
        public var warnings: [Finding] { findings.filter { $0.severity == .warning } }
        public var passes: Bool { errors.isEmpty }

        public var summary: String {
            if findings.isEmpty { return "\(label): pass (no findings)" }
            let head = passes ? "\(label): pass with \(warnings.count) warning(s)"
                              : "\(label): FAIL — \(errors.count) error(s), \(warnings.count) warning(s)"
            return ([head] + findings.map { "  " + $0.description }).joined(separator: "\n")
        }

        /// Combines reports so a document with several gates produces one verdict.
        public static func merge(_ reports: [Report], label: String) -> Report {
            Report(label: label, findings: reports.flatMap(\.findings))
        }
    }
}
