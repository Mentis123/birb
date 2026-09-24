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
        monitor.forgetSlowFrames()
        let verdict = monitor.record(40, at: 0.2)
        XCTAssertNil(verdict.giveUp, "a new loop starts with a clean record")
        XCTAssertFalse(verdict.report, "but the log is not flooded because a loop changed")
    }
}
