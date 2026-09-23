import Foundation

/// Pencil pressure, from the raw reading to what a brush does with it.
///
/// ## What it replaces, and why each part is here
///
/// The editor used to take `force / maximumPossibleForce`, floor it at 0.35,
/// and multiply it into the brush strength. Four things were wrong with that,
/// and between them they are most of "the range of pressures for sizes and
/// having it function well":
///
/// - **Pressure never touched the size.** Every sculpting and painting app a
///   person has used makes a light touch a small mark; here the brush was one
///   size whatever the hand did.
/// - **Paint read it once.** The paint brush was built at touch-down, from the
///   FIRST sample — and the first sample of a Pencil stroke is the lightest
///   one in it, because the tip is still landing. So a whole stroke painted at
///   the opacity of its touch-down, about 30%, however hard it was pressed
///   afterwards. That reads as "paint doesn't work".
/// - **The floor flattened the bottom third of the range**, so a light touch
///   and a medium one did the same thing.
/// - **A linear map wastes most of the Pencil's travel.** `maximumPossibleForce`
///   is about 4.2 and a firm stroke on glass reads 2 to 2.5, so half the
///   normalised range is pressure nobody applies on purpose.
///
/// So: a force that counts as a full press (`fullForce`), a curve, and then
/// separate, optional ranges for size and for strength. Grab ignores all of
/// it — a surface held by the Pencil moves with the Pencil — and that decision
/// lives in the stroke engine.
public struct PressureResponse: Sendable, Equatable {
    /// The shape between a feather touch and a full press.
    public enum Curve: String, CaseIterable, Sendable, Identifiable {
        /// Light pressure counts for more. The default: most of what a hand
        /// does on glass is light-to-medium.
        case soft = "Soft"
        case linear = "Linear"
        /// Light pressure counts for less: fine control at the bottom.
        case firm = "Firm"

        public var id: String { rawValue }

        /// The exponent applied to the normalised press.
        public var exponent: Double {
            switch self {
            case .soft: return 0.6
            case .linear: return 1.0
            case .firm: return 1.7
            }
        }
    }

    /// The normalised force (`force / maximumPossibleForce`) that counts as a
    /// full press. Anything harder is still a full press.
    public var fullForce: Double
    public var curve: Curve
    /// Whether pressure changes the brush size.
    public var sizeFollowsPressure: Bool
    /// The size at the lightest touch, as a fraction of the full size.
    public var minimumSize: Double
    /// Whether pressure changes strength (sculpting) and opacity (painting).
    public var strengthFollowsPressure: Bool
    /// The strength at the lightest touch, as a fraction of the full strength.
    public var minimumStrength: Double

    public init(fullForce: Double = 0.5, curve: Curve = .soft,
                sizeFollowsPressure: Bool = true, minimumSize: Double = 0.2,
                strengthFollowsPressure: Bool = true, minimumStrength: Double = 0.2) {
        self.fullForce = fullForce
        self.curve = curve
        self.sizeFollowsPressure = sizeFollowsPressure
        self.minimumSize = minimumSize
        self.strengthFollowsPressure = strengthFollowsPressure
        self.minimumStrength = minimumStrength
    }

    /// How hard the Pencil is pressed, 0...1, after the curve.
    ///
    /// `nil` is input that reports no pressure — a finger on an iPad, or a
    /// pointer — and counts as a full press: a finger stroke did the full brush
    /// before this existed, and should go on doing so.
    public func level(forNormalisedForce force: Double?) -> Double {
        guard let force, force.isFinite else { return 1 }
        let pressed = min(1, max(0, force / max(1e-6, fullForce)))
        return pow(pressed, curve.exponent)
    }

    /// What the brush size is multiplied by at a pressure level.
    public func sizeScale(level: Double) -> Double {
        guard sizeFollowsPressure else { return 1 }
        let floor = min(1, max(0, minimumSize))
        return floor + (1 - floor) * min(1, max(0, level))
    }

    /// What strength and opacity are multiplied by at a pressure level.
    public func strengthScale(level: Double) -> Double {
        guard strengthFollowsPressure else { return 1 }
        let floor = min(1, max(0, minimumStrength))
        return floor + (1 - floor) * min(1, max(0, level))
    }
}

/// Takes the jitter out of a stroke's pressure without making it late.
///
/// The Pencil reports force at 240 Hz and the readings are noisy and quantised,
/// especially while the tip is landing; used raw, a brush whose size follows
/// pressure ripples along its edge. An exponential filter closing `response`
/// of the gap per sample has a time constant of about two samples — eight
/// milliseconds — which is under a frame at 120 Hz: smooth, and not lagging.
public struct PressureFilter: Sendable {
    /// The fraction of the gap to the new reading closed per sample.
    public var response: Double
    private(set) public var value: Double?

    public init(response: Double = 0.45) {
        self.response = response
    }

    /// Starts a new stroke: the next reading is taken as it is.
    public mutating func reset() { value = nil }

    /// Folds in one reading and returns the filtered level.
    @discardableResult
    public mutating func feed(_ level: Double) -> Double {
        guard let current = value else {
            value = level
            return level
        }
        let next = current + (level - current) * min(1, max(0, response))
        value = next
        return next
    }
}
