import XCTest
@testable import HumanoidCore

/// The frame breakdown and the rules that decide when a loop is starving the
/// main thread. The loop itself runs only on an iPad; what it decides from
/// its measurements is tested here.
final class FrameTimingTests: XCTestCase {
    func testTheSummaryLeadsWithWhereTheTimeWent() {
        let frame = FrameTiming(drain: 3, drawable: 790, buffers: 0, submit: 19, total: 812)
        XCTAssertEqual(frame.summary, "812.0 ms: drawable 790.0, submit 19.0, drain 3.0, buffers 0.0")
        XCTAssertEqual(frame.parts.first?.name, "drawable")
    }

    func testEqualPhasesAlwaysReadInTheSameOrder() {
        let frame = FrameTiming(total: 0)
        XCTAssertEqual(frame.parts.map(\.name), ["drawable", "drain", "submit", "buffers"])
    }

    func testAnOrdinaryFrameIsNotSlowAndSaysNothing() {
        var monitor = MainThreadMonitor()
        for i in 0..<600 {
            let verdict = monitor.record(6, at: Double(i) / 120)
            XCTAssertFalse(verdict.slow)
            XCTAssertFalse(verdict.report)
            XCTAssertNil(verdict.giveUp)
        }
    }

    func testOneHangGivesUpAtOnce() {
        var monitor = MainThreadMonitor()
        let verdict = monitor.record(812, at: 1)
        XCTAssertTrue(verdict.slow)
        XCTAssertEqual(verdict.giveUp, "one frame held the main thread for 812 ms")
    }

    func testThreeSlowFramesInTwoSecondsGiveUp() {
        var monitor = MainThreadMonitor()
        XCTAssertNil(monitor.record(40, at: 10.0).giveUp)
        XCTAssertNil(monitor.record(40, at: 10.5).giveUp)
        XCTAssertNotNil(monitor.record(40, at: 11.9).giveUp)
    }

    func testSlowFramesSpreadOutDoNot() {
        // A slow frame now and then — a stroke ending, the paint map landing —
        // is not a loop starving the main thread.
        var monitor = MainThreadMonitor()
        for i in 0..<10 {
            XCTAssertNil(monitor.record(40, at: Double(i) * 1.5).giveUp, "frame \(i)")
        }
    }

    func testTheBoundariesAreStrict() {
        var monitor = MainThreadMonitor()
        XCTAssertFalse(monitor.record(MainThreadMonitor.slowMilliseconds, at: 0).slow)
        XCTAssertNil(monitor.record(MainThreadMonitor.hangMilliseconds, at: 10).giveUp)
        XCTAssertNotNil(monitor.record(MainThreadMonitor.hangMilliseconds + 1, at: 20).giveUp)
    }

    func testTheLogGetsOneLinePerSecondAndCountsTheRest() {
        var monitor = MainThreadMonitor()
        var reported: [Double] = []
        var lastUnreported = -1
        for i in 0..<60 {
            let time = Double(i) / 20   // 20 slow frames a second for 3 s
            let verdict = monitor.record(40, at: time)
            if verdict.report {
                reported.append(time)
                lastUnreported = verdict.unreported
            }
        }
        XCTAssertEqual(reported.count, 3, "one line per second, not one per frame")
        XCTAssertEqual(reported.first, 0)
        XCTAssertEqual(lastUnreported, 19, "the frames between two lines are counted, not lost")
    }

    func testForgettingKeepsTheRateLimit() {
        var monitor = MainThreadMonitor()
        _ = monitor.record(40, at: 0)
        _ = monitor.record(40, at: 0.1)
        monitor.forgetFrames()
        let verdict = monitor.record(40, at: 0.2)
        XCTAssertNil(verdict.giveUp, "a new loop starts with a clean record")
        XCTAssertFalse(verdict.report, "but the log is not flooded because a loop changed")
    }

    // MARK: - Gaps a review found (2026-09-24)

    func testOneSlowFrameInAnOrdinaryStreamIsNotAVerdict() {
        // Every ordinary frame must stay out of the slow-frame count. Counting
        // them made a single 40 ms frame in a 120 Hz stream give up.
        var monitor = MainThreadMonitor()
        var gaveUp = false
        for i in 0..<240 {
            let milliseconds = i == 100 ? 40.0 : 4.0
            if monitor.record(milliseconds, at: Double(i) / 120).giveUp != nil { gaveUp = true }
        }
        XCTAssertFalse(gaveUp)
    }

    func testTheVerdictDoesNotWaitForTheLog() {
        // The third slow frame falls inside the log's quiet second and is not
        // written down; it must still end the loop.
        var monitor = MainThreadMonitor()
        let first = monitor.record(40, at: 0)
        let second = monitor.record(40, at: 0.1)
        let third = monitor.record(40, at: 0.2)
        XCTAssertTrue(first.report)
        XCTAssertFalse(second.report)
        XCTAssertFalse(third.report)
        XCTAssertNotNil(third.giveUp)
    }

    func testTheSlowFrameWindowIsTwoSecondsExactly() {
        var inside = MainThreadMonitor()
        _ = inside.record(40, at: 0)
        _ = inside.record(40, at: 1)
        XCTAssertNotNil(inside.record(40, at: 2.0).giveUp, "a frame exactly two seconds old still counts")

        var outside = MainThreadMonitor()
        _ = outside.record(40, at: 0)
        _ = outside.record(40, at: 1)
        XCTAssertNil(outside.record(40, at: 2.001).giveUp, "one older than that does not")
    }

    func testBackToBackOrdinaryFramesAreSaturation() {
        // The fifth device run's shape: nothing slow, nothing idle. A review
        // ran five seconds of back-to-back 16 ms frames through the first
        // version of this monitor and got no verdict and no log line.
        var monitor = MainThreadMonitor()
        var time = 0.0
        var firstGiveUp: Double?
        var reports = 0
        while time < 5 {
            time += 0.016
            let verdict = monitor.record(16, at: time)
            XCTAssertFalse(verdict.slow)
            if verdict.report { reports += 1 }
            if verdict.giveUp != nil, firstGiveUp == nil { firstGiveUp = time }
        }
        let at = try? XCTUnwrap(firstGiveUp)
        XCTAssertNotNil(at, "a saturated main thread gives up")
        XCTAssertGreaterThanOrEqual(at ?? 0, MainThreadMonitor.shareWindow,
                                    "but only once a whole window of it has been seen")
        XCTAssertLessThan(at ?? .infinity, MainThreadMonitor.shareWindow + 0.05)
        XCTAssertGreaterThanOrEqual(reports, 4, "and it is written down, once a second")
        XCTAssertLessThanOrEqual(reports, 5)
    }

    func testAnOrdinaryDrawingLoopIsNotSaturated() {
        // 120 Hz frames that take 3 ms: a quarter of the time, and nothing to
        // report at either threshold the app uses.
        for threshold in [0.5, 0.85] {
            var monitor = MainThreadMonitor(saturatedShare: threshold)
            for i in 1...600 {
                let verdict = monitor.record(3, at: Double(i) / 120)
                XCTAssertFalse(verdict.saturated, "at \(threshold), frame \(i)")
                XCTAssertNil(verdict.giveUp)
                XCTAssertFalse(verdict.report)
            }
        }
    }

    func testTheThresholdIsTheCallersToSet() {
        // Waiting that fills 60% of the frame is saturation for a loop judged
        // on its waits (0.5), and not for one judged on whole frames (0.85).
        var waits = MainThreadMonitor(saturatedShare: 0.5)
        var frames = MainThreadMonitor(saturatedShare: 0.85)
        var waitsGaveUp = false, framesGaveUp = false
        for i in 1...360 {
            let time = Double(i) / 120
            if waits.record(5, at: time).giveUp != nil { waitsGaveUp = true }
            if frames.record(5, at: time).giveUp != nil { framesGaveUp = true }
        }
        XCTAssertTrue(waitsGaveUp)
        XCTAssertFalse(framesGaveUp)
    }

    func testTheBusyShareIsTheSumOfTheLastSecond() {
        // The running sum against a brute-force one, over a long irregular
        // run, so the ring's bookkeeping cannot drift or drop the wrong frame.
        var monitor = MainThreadMonitor()
        var history: [(time: Double, seconds: Double)] = []
        var generator = SplitMix(seed: 7)
        var time = 0.0
        for _ in 0..<5_000 {
            time += 0.002 + generator.unit() * 0.02
            let milliseconds = generator.unit() * 12
            let verdict = monitor.record(milliseconds, at: time)
            history.append((time, milliseconds / 1000))
            let expected = history
                .filter { time - $0.time < MainThreadMonitor.shareWindow }
                .reduce(0) { $0 + $1.seconds } / MainThreadMonitor.shareWindow
            XCTAssertEqual(verdict.busyShare, min(1, expected), accuracy: 1e-9)
        }
    }

    func testAFrameExactlyAWindowOldIsOutOfTheShare() {
        // The share is the frames YOUNGER than the window, the same rule the
        // brute-force sum below uses; exact times pin the boundary itself.
        var monitor = MainThreadMonitor()
        _ = monitor.record(500, at: 0)
        let verdict = monitor.record(100, at: MainThreadMonitor.shareWindow)
        XCTAssertEqual(verdict.busyShare, 0.1, accuracy: 1e-12)
    }

    func testForgettingStartsTheShareOver() {
        var monitor = MainThreadMonitor()
        var time = 0.0
        for _ in 0..<200 {
            time += 0.016
            _ = monitor.record(16, at: time)
        }
        monitor.forgetFrames()
        // Busy from its first frame: still watched for a whole window before
        // it can be judged, however long the loop before it ran.
        let switched = time
        var firstSaturated: Double?
        while time - switched < 1.5 {
            time += 0.016
            if monitor.record(16, at: time).saturated, firstSaturated == nil { firstSaturated = time }
        }
        XCTAssertNotNil(firstSaturated)
        XCTAssertGreaterThanOrEqual((firstSaturated ?? 0) - switched,
                                    MainThreadMonitor.shareWindow - 1e-9,
                                    "a new loop is watched for a whole window before judging")
    }
}

/// A tiny deterministic generator, so the property test is the same test
/// every run.
private struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
}
