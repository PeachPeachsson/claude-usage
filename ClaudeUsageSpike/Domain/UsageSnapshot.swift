import Foundation

struct UsageWindowSnapshot: Equatable, Sendable {
    let title: String
    let utilization: Double
    let resetsAt: Date?

    var normalizedUtilization: Double {
        min(max(utilization, 0), 100)
    }
}

struct UsageSnapshot: Equatable, Sendable {
    let fiveHour: UsageWindowSnapshot?
    let sevenDay: UsageWindowSnapshot?
    let scopedWindow: UsageWindowSnapshot?
    let fetchedAt: Date

    var windows: [UsageWindowSnapshot] {
        [fiveHour, sevenDay, scopedWindow].compactMap { $0 }
    }

    func experimentReport(refreshDuration: TimeInterval) -> String {
        let observedAt = Self.formatExperimentDate(fetchedAt)
        let duration = Self.formatExperimentNumber(refreshDuration, maximumFractionDigits: 2)
        let fiveHour = Self.reportLine(label: "5-hour", window: fiveHour)
        let sevenDay = Self.reportLine(label: "Weekly", window: sevenDay)
        let scoped = Self.reportLine(label: "Scoped", window: scopedWindow)

        return """
        EXP-001 app observation
        Observed at: \(observedAt)
        Refresh duration: \(duration) s
        \(fiveHour)
        \(sevenDay)
        \(scoped)
        """
    }

    private static func reportLine(label: String, window: UsageWindowSnapshot?) -> String {
        guard let window else { return "\(label): unavailable" }

        let utilization = formatExperimentNumber(
            window.normalizedUtilization,
            maximumFractionDigits: 2
        )
        let reset = window.resetsAt.map(formatExperimentDate) ?? "unavailable"
        return "\(label): \(utilization)% | reset: \(reset)"
    }

    private static func formatExperimentDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func formatExperimentNumber(
        _ value: Double,
        maximumFractionDigits: Int
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = maximumFractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

enum UsagePayloadError: Error, Equatable {
    case noUsageWindows
}

enum UsagePayloadDecoder {
    static func decode(_ data: Data, fetchedAt: Date = Date()) throws -> UsageSnapshot {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let payload = try decoder.decode(Payload.self, from: data)

        let fiveHour = payload.fiveHour.map {
            UsageWindowSnapshot(
                title: "5-hour window",
                utilization: $0.utilization,
                resetsAt: parseDate($0.resetsAt)
            )
        }
        let sevenDay = payload.sevenDay.map {
            UsageWindowSnapshot(
                title: "Weekly window",
                utilization: $0.utilization,
                resetsAt: parseDate($0.resetsAt)
            )
        }
        let scoped = payload.limits?
            .compactMap { limit -> UsageWindowSnapshot? in
                guard limit.kind == "weekly_scoped",
                      let name = limit.scope?.model?.displayName else {
                    return nil
                }
                return UsageWindowSnapshot(
                    title: name,
                    utilization: limit.percent,
                    resetsAt: parseDate(limit.resetsAt)
                )
            }
            .max { $0.utilization < $1.utilization }

        guard fiveHour != nil || sevenDay != nil || scoped != nil else {
            throw UsagePayloadError.noUsageWindows
        }

        return UsageSnapshot(
            fiveHour: fiveHour,
            sevenDay: sevenDay,
            scopedWindow: scoped,
            fetchedAt: fetchedAt
        )
    }

    private static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private struct Payload: Decodable {
        let fiveHour: Window?
        let sevenDay: Window?
        let limits: [Limit]?
    }

    private struct Window: Decodable {
        let utilization: Double
        let resetsAt: String?
    }

    private struct Limit: Decodable {
        let kind: String
        let percent: Double
        let resetsAt: String?
        let scope: Scope?
    }

    private struct Scope: Decodable {
        let model: Model?
    }

    private struct Model: Decodable {
        let displayName: String?
    }
}

enum OrganizationSelector {
    static func selectOrganizationID(from data: Data) -> String? {
        guard let organizations = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              !organizations.isEmpty else {
            return nil
        }

        let preferred = organizations.first { organization in
            let capabilities = organization["capabilities"] as? [String] ?? []
            return capabilities.contains { capability in
                let normalized = capability.lowercased()
                return normalized.contains("chat") || normalized.contains("claude_ai")
            }
        }

        return identifier(from: preferred ?? organizations[0])
    }

    private static func identifier(from organization: [String: Any]) -> String? {
        if let uuid = organization["uuid"] as? String, !uuid.isEmpty {
            return uuid
        }
        if let id = organization["id"] as? String, !id.isEmpty {
            return id
        }
        return nil
    }
}
