import Foundation
import XCTest
@testable import ClaudeUsageSpike

final class UsagePayloadDecoderTests: XCTestCase {
    func testDecodesCoreAndScopedUsageWindows() throws {
        let data = Data(
            """
            {
              "five_hour": {
                "utilization": 27.5,
                "resets_at": "2026-09-01T15:00:00.000Z"
              },
              "seven_day": {
                "utilization": 62,
                "resets_at": "2026-09-05T09:30:00Z"
              },
              "limits": [
                {
                  "kind": "weekly_scoped",
                  "percent": 71,
                  "resets_at": "2026-09-05T09:30:00Z",
                  "scope": { "model": { "display_name": "Opus" } }
                }
              ]
            }
            """.utf8
        )

        let fetchedAt = Date(timeIntervalSince1970: 1_788_000_000)
        let snapshot = try UsagePayloadDecoder.decode(data, fetchedAt: fetchedAt)

        XCTAssertEqual(snapshot.fiveHour?.utilization, 27.5)
        XCTAssertEqual(snapshot.sevenDay?.utilization, 62)
        XCTAssertEqual(snapshot.scopedWindow?.title, "Opus")
        XCTAssertEqual(snapshot.scopedWindow?.utilization, 71)
        XCTAssertEqual(snapshot.fetchedAt, fetchedAt)
    }

    func testRejectsPayloadWithoutUsageWindows() {
        XCTAssertThrowsError(try UsagePayloadDecoder.decode(Data("{}".utf8))) { error in
            XCTAssertEqual(error as? UsagePayloadError, .noUsageWindows)
        }
    }

    func testClampsDisplayedUtilization() {
        let window = UsageWindowSnapshot(title: "Test", utilization: 105, resetsAt: nil)
        XCTAssertEqual(window.normalizedUtilization, 100)
    }

    func testBuildsAnonymizedExperimentReport() throws {
        let fetchedAt = Date(timeIntervalSince1970: 1_788_000_000)
        let snapshot = UsageSnapshot(
            fiveHour: UsageWindowSnapshot(
                title: "5-hour window",
                utilization: 27.5,
                resetsAt: Date(timeIntervalSince1970: 1_788_003_600)
            ),
            sevenDay: nil,
            scopedWindow: nil,
            fetchedAt: fetchedAt
        )

        let report = snapshot.experimentReport(refreshDuration: 1.25)

        XCTAssertTrue(report.contains("Refresh duration: 1.25 s"))
        XCTAssertTrue(report.contains("5-hour: 27.5%"))
        XCTAssertTrue(report.contains("Weekly: unavailable"))
        XCTAssertFalse(report.lowercased().contains("organization"))
    }
}

final class OrganizationSelectorTests: XCTestCase {
    func testPrefersClaudeChatOrganization() {
        let data = Data(
            """
            [
              {"uuid":"api-org","capabilities":["api"]},
              {"uuid":"chat-org","capabilities":["chat","claude_ai"]}
            ]
            """.utf8
        )

        XCTAssertEqual(OrganizationSelector.selectOrganizationID(from: data), "chat-org")
    }

    func testFallsBackToFirstOrganizationAndAcceptsID() {
        let data = Data("[{\"id\":\"first-org\",\"capabilities\":[\"api\"]}]".utf8)
        XCTAssertEqual(OrganizationSelector.selectOrganizationID(from: data), "first-org")
    }
}
