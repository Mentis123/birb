// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "HeadlessProof",
  targets: [
    .target(name: "UfbxC", path: "Sources/UfbxC"),
    .target(name: "HumanoidCore", dependencies: ["UfbxC"]),
    .testTarget(name: "HumanoidCoreTests", dependencies: ["HumanoidCore"], resources: [.copy("Fixtures")]),
  ]
)
