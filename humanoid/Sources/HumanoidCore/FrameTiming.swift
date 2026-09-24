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
    /// Everything before the drawable: draining the frame's input into the
    /// document (the sculpt and paint work), and building the readout's text
    /// when it is showing.
    public var drain: Double
    /// Waiting for the layer to hand over a drawable. This blocks until the
    /// display gives one back, for up to a second. On the first frame after a
    /// resize or a rotation it also includes MetalKit rebuilding its
    /// multisample and depth textures, which happens inside the same call.
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
///
/// **Three rules, because there are three shapes of trouble.** One frame over
/// `hangMilliseconds` is a hang on its own. Several frames over
/// `slowMilliseconds` close together is a loop that stalls. And frames that
/// are each unremarkable but leave the main thread no time between them —
/// more than `saturatedShare` of the last `shareWindow` — is the fifth device
/// run's shape exactly, which the first version of this type could not see:
/// a review ran five seconds of back-to-back 16 ms frames through it and got
/// neither a verdict nor a line in the log.
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
    /// The span the busy share is measured over, and the least a loop must be
    /// watched before it can be called saturated.
    public static let shareWindow = 1.0
    /// At most one log line per this many seconds. A slow loop is slow every
    /// frame, and a line per frame is a log nobody reads.
    public static let reportInterval = 1.0
    /// Frames remembered for the busy share. A second at 240 Hz is 240; more
    /// than this in one window and the oldest are forgotten, which can only
    /// understate the share.
    public static let capacity = 512

    public struct Verdict: Equatable, Sendable {
        /// This frame on its own was over `slowMilliseconds`.
        public var slow = false
        /// The frames of the last `shareWindow` held the main thread for more
        /// than the monitor's `saturatedShare` of it.
        public var saturated = false
        /// That share, 0 to 1, for the log line.
        public var busyShare = 0.0
        /// Write this frame down: the first slow or saturated frame since the
        /// last line.
        public var report = false
        /// Slow or saturated frames since the last line that were NOT written
        /// down, this one excluded. Worth printing beside it: one slow frame
        /// and forty read the same otherwise.
        public var unreported = 0
        /// Set when the frames so far say the loop producing them should stop.
        public var giveUp: String?
    }

    /// Over this share of `shareWindow` spent inside recorded frames, the main
    /// thread is saturated. What counts depends on what is recorded: a whole
    /// frame can reasonably fill much of a stroke's time with sculpting, while
    /// time spent only WAITING (for a drawable, for scheduling) should be a
    /// sliver of it.
    public let saturatedShare: Double

    private var slowTimes: [Double] = []
    private var lastReport = -Double.infinity
    private var unreported = 0

    // The busy share: a ring of the last `capacity` frames, their end times
    // and their costs in seconds, with a running sum. Fixed storage, so
    // recording a frame never allocates.
    private var ringTimes = [Double](repeating: 0, count: MainThreadMonitor.capacity)
    private var ringCosts = [Double](repeating: 0, count: MainThreadMonitor.capacity)
    private var ringStart = 0
    private var ringCount = 0
    private var ringSum = 0.0
    /// When watching began, so a loop is judged saturated only after a whole
    /// `shareWindow` of it has been seen.
    private var watchingSince: Double?

    public init(saturatedShare: Double = 0.85) {
        self.saturatedShare = saturatedShare
    }

    /// Records one frame that held the main thread for `milliseconds`,
    /// finishing at `time` (seconds, any monotonic clock).
    public mutating func record(_ milliseconds: Double, at time: Double) -> Verdict {
        var verdict = Verdict()
        let seconds = max(0, milliseconds) / 1000

        // The busy share, over every frame, slow or not.
        if watchingSince == nil { watchingSince = time - seconds }
        let capacity = MainThreadMonitor.capacity
        while ringCount > 0, time - ringTimes[ringStart] >= MainThreadMonitor.shareWindow {
            dropOldest()
        }
        if ringCount == capacity { dropOldest() }
        let slot = (ringStart + ringCount) % capacity
        ringTimes[slot] = time
        ringCosts[slot] = seconds
        ringCount += 1
        ringSum += seconds
        verdict.busyShare = min(1, max(0, ringSum) / MainThreadMonitor.shareWindow)
        let watchedLongEnough = time - (watchingSince ?? time) >= MainThreadMonitor.shareWindow
        verdict.saturated = watchedLongEnough && verdict.busyShare > saturatedShare

        // Slow frames: one hang, or several close together.
        if milliseconds > MainThreadMonitor.slowMilliseconds {
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
        }
        if verdict.giveUp == nil, verdict.saturated {
            verdict.giveUp = "its frames held the main thread for "
                + "\(Int((verdict.busyShare * 100).rounded()))% of the last "
                + "\(Int(MainThreadMonitor.shareWindow)) s"
        }

        guard verdict.slow || verdict.saturated else { return verdict }
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

    /// Forgets every frame so far, keeping the log's rate limit. For a loop
    /// that has just been switched: its successor starts with a clean record
    /// rather than inheriting the frames that condemned it.
    public mutating func forgetFrames() {
        slowTimes.removeAll(keepingCapacity: true)
        ringStart = 0
        ringCount = 0
        ringSum = 0
        watchingSince = nil
    }

    private mutating func dropOldest() {
        ringSum -= ringCosts[ringStart]
        ringStart = (ringStart + 1) % MainThreadMonitor.capacity
        ringCount -= 1
        if ringCount == 0 { ringSum = 0 }
    }
}

/// How often frames arrive while the loop is drawing continuously: the
/// readout's first line.
///
/// It used to divide by the gap between one frame and the next, whatever
/// filled the gap, and label the result "cpu+gpu". The loop draws on demand,
/// so between strokes that gap is however long the iPad sat untouched: the
/// sixth device run's readout said "3.4 fps, cpu+gpu 296 ms (worst 15325)"
/// about a loop that was drawing every 12 to 20 ms whenever anything moved.
/// A gap counts as a frame interval only when the frame that opened it was
/// drawn in continuous mode too; the rest is the app waiting for a touch.
public struct FramePacing: Sendable {
    /// Intervals remembered: a second at 120 Hz.
    public static let capacity = 120

    private var intervals = [Double](repeating: 0, count: FramePacing.capacity)
    private var head = 0
    public private(set) var count = 0
    private var previous: Double?

    public init() {}

    /// A frame started at `time` (seconds, any monotonic clock).
    /// `continuous` is whether the loop is drawing every refresh — a stroke,
    /// a hover or a coast — rather than drawing because something asked.
    public mutating func frame(at time: Double, continuous: Bool) {
        if continuous, let previous, time > previous {
            intervals[(head + count) % FramePacing.capacity] = (time - previous) * 1000
            if count < FramePacing.capacity { count += 1 } else { head = (head + 1) % FramePacing.capacity }
        }
        previous = continuous ? time : nil
    }

    /// The mean interval in milliseconds, or nil before any was measured.
    public var meanMilliseconds: Double? {
        guard count > 0 else { return nil }
        var sum = 0.0
        for i in 0..<count { sum += intervals[(head + i) % FramePacing.capacity] }
        return sum / Double(count)
    }

    /// The longest interval remembered, in milliseconds.
    public var worstMilliseconds: Double? {
        guard count > 0 else { return nil }
        var worst = 0.0
        for i in 0..<count { worst = max(worst, intervals[(head + i) % FramePacing.capacity]) }
        return worst
    }

    /// "drawing 118 fps: a frame every 8.5 ms (worst 16.9)".
    public var summary: String {
        guard let mean = meanMilliseconds, let worst = worstMilliseconds, mean > 0 else {
            return "idle: nothing drawn continuously yet"
        }
        return String(format: "drawing %.0f fps: a frame every %.1f ms (worst %.1f)",
                      1000 / mean, mean, worst)
    }
}
