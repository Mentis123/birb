// swift-tools-version:6.0
import PackageDescription
let package = Package(
  name: "HumanoidProbe",
  platforms: [.iOS(.v17), .macOS(.v14)],
  targets: [
    .target(name: "HumanoidCore"),
    .target(name: "UFBX", cSettings: [.unsafeFlags(["-std=c99"])]),
    .target(name: "GeometryBridge", cxxSettings: [.unsafeFlags(["-std=c++20", "-Wno-everything"])]),
    .target(name: "BridgeSwift", dependencies: ["UFBX", "GeometryBridge", "HumanoidCore"],
            swiftSettings: [.interoperabilityMode(.Cxx)]),
    .testTarget(name: "CoreXCTests", dependencies: ["HumanoidCore"]),
    .testTarget(name: "CoreSwiftTests", dependencies: ["HumanoidCore"]),
    .testTarget(name: "BridgeTests", dependencies: ["BridgeSwift"], swiftSettings: [.interoperabilityMode(.Cxx)]),
    .testTarget(name: "BridgeXCTests", dependencies: ["BridgeSwift"], swiftSettings: [.interoperabilityMode(.Cxx)]),
  ],
  cxxLanguageStandard: .cxx20
)
