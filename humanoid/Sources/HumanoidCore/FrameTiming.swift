import Foundation

/// Where one frame's main-thread time went, in milliseconds.
///
/// The fifth device run (2026-09-24) logged thirty-nine `Hang detected` lines,
/// from 0.26 s to 5.05 s, and nothing that said which call any of them was in.
/// "Laggy" is not something a test can reproduce; a frame that says "812 ms,
/// of which 790 waiting for a drawable" is. Every phase that can block the
/// main thread is timed on its own, because the fixes for "the display has
/// not given a drawable back" and "a thousand samples were drained at once"
/// have nothing in common.
public struct FrameTiming: Equatable, Sendable {
    /// Draining the frame's input into the document: the sculpt and paint work.
    public var drain: Double
    /// Waiting for the layer to hand over a drawable. This blocks until the
    /// display gives one back, for up to a second.
    public var drawable: Double
    /// Waiting for a vertex buffer the GPU has finished reading.
    public var buffers: Double
    /// Committing the work and, when the frame is presented inside a Core
    /// Animation transaction, waiting until the GPU has scheduled it.
    public var submit: Double
    /// The whole frame, start to finish, including anything not itemised.
    public var total: Double

    public init(drain: Double = 0, drawable: Double = 0, buffers: Double = 0,
                submit: Double = 0, total: Double = 0) {
        self.drain = drain
        self.drawable = drawable
        self.buffers = buffers
        self.submit = submit
        self.total = total
    }

    /// The phases, largest first — the first word is the diagnosis. Ties keep
    /// the order below so the same frame always reads the same way.
    public var parts: [(name: String, milliseconds: Double)] {
        let named: [(name: String, milliseconds: Double)] = [
            ("drawable", drawable), ("drain", drain), ("submit", submit), ("buffers", buffers),
        ]
        return named.enumerated()
            .sorted { a, b in
                a.element.milliseconds != b.element.milliseconds
                    ? a.element.milliseconds > b.element.milliseconds
                    : a.offset < b.offset
            }
            .map { $0.element }
    }

    /// "812.0 ms: drawable 790.0, submit 19.0, drain 3.0, buffers 0.0".
    public var summary: String {
        // Interpolated rather than `%@`: a Swift `String` is not a C vararg
        // on Linux, where this is tested.
        String(format: "%.1f ms: ", total)
            + parts.map { "\($0.name) " + String(format: "%.1f", $0.milliseconds) }
                .joined(separator: ", ")
    }
}

/// Watches how long frames hold the main thread: when one is worth a line in
/// the log, and when the loop producing them should give way to a safer one.
///
/// Both exist because of the fifth device run. The low-latency loop had been
/// the default for one run, never measured on an iPad, and it kept the main
/// thread busy for the whole of every stroke — three of the "hangs" were
/// exactly the five seconds the stroke watchdog waits before closing a stroke
/// whose Pencil samples had stopped arriving. It watched for a loop that
/// stops drawing. It had no idea what to do about a loop that draws and
/// starves everything else, so it did nothing.
public struct MainThreadMonitor: Sendable {
    /// Over this, a frame is slow: two frames at 60 Hz, four at 120.
    public static let slowMilliseconds = 34.0
    /// Over this, one frame is a hang by Apple's own definition — the
    /// threshold of the "Hang detected" report — and a loop that can produce
    /// one gives way at once.
    public static let hangMilliseconds = 250.0
    /// This many slow frames within `window` seconds and the loop gives way.
    public static let slowFramesToGiveUp = 3
    public static let window = 2.0
    /// At most one log line per this many seconds. A slow loop is slow every
    /// frame, and a line per frame is a log nobody reads.
    public static let reportInterval = 1.0

    public struct Verdict: Equatable, Sendable {
        public var slow = false
        /// Write this frame down: the first slow frame since the last line.
        public var report = false
        /// Slow frames since the last line that were NOT written down, this
        /// one excluded. Worth printing beside it: one slow frame and forty
        /// read the same otherwise.
        public var unreported = 0
        /// Set when the frames so far say the loop producing them should stop.
        public var giveUp: String?
    }

    private var slowTimes: [Double] = []
    private var lastReport = -Double.infinity
    private var unreported = 0

    public init() {}

    /// Records one frame that held the main thread for `milliseconds`,
    /// finishing at `time` (seconds, any monotonic clock).
    public mutating func record(_ milliseconds: Double, at time: Double) -> Verdict {
        var verdict = Verdict()
        guard milliseconds > MainThreadMonitor.slowMilliseconds else { return verdict }
        verdict.slow = true

        slowTimes.removeAll { time - $0 > MainThreadMonitor.window }
        slowTimes.append(time)
        if milliseconds > MainThreadMonitor.hangMilliseconds {
            verdict.giveUp = "one frame held the main thread for \(Int(milliseconds.rounded())) ms"
        } else if slowTimes.count >= MainThreadMonitor.slowFramesToGiveUp {
            verdict.giveUp = "\(slowTimes.count) frames held the main thread over "
                + "\(Int(MainThreadMonitor.slowMilliseconds)) ms within "
                + "\(Int(MainThreadMonitor.window)) s"
        }

        if time - lastReport >= MainThreadMonitor.reportInterval {
            verdict.report = true
            verdict.unreported = unreported
            lastReport = time
            unreported = 0
        } else {
            unreported += 1
        }
        return verdict
    }

    /// Forgets the slow frames so far, keeping the log's rate limit. For a
    /// loop that has just been switched: its successor starts with a clean
    /// record rather than inheriting the frames that condemned it.
    public mutating func forgetSlowFrames() {
        slowTimes.removeAll(keepingCapacity: true)
    }
}
