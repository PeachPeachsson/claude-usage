import Foundation
import WebKit

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published private(set) var snapshot: UsageSnapshot?
    @Published private(set) var isRefreshing = false
    @Published private(set) var lastRefreshDuration: TimeInterval?
    @Published private(set) var needsSignIn = false
    @Published private(set) var errorMessage: String?
    @Published var isShowingSignIn = false

    private let provider: UsageProviding

    var authenticationWebView: WKWebView {
        provider.authenticationWebView
    }

    init(provider: UsageProviding? = nil) {
        self.provider = provider ?? ClaudeWebUsageProvider()
    }

    func refresh() async {
        guard !isRefreshing else { return }
        let startedAt = ContinuousClock.now
        isRefreshing = true
        errorMessage = nil
        defer { isRefreshing = false }

        do {
            snapshot = try await provider.fetchUsage()
            lastRefreshDuration = TimeInterval(ContinuousClock.now - startedAt)
            needsSignIn = false
        } catch ClaudeUsageProviderError.requiresSignIn {
            lastRefreshDuration = nil
            needsSignIn = true
        } catch {
            lastRefreshDuration = nil
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func showSignIn() {
        provider.beginAuthentication()
        isShowingSignIn = true
    }

    func completeSignIn() {
        isShowingSignIn = false
        Task { await refresh() }
    }

    func disconnect() async {
        await provider.disconnect()
        snapshot = nil
        lastRefreshDuration = nil
        needsSignIn = true
        errorMessage = nil
    }
}

private extension TimeInterval {
    init(_ duration: Duration) {
        self = Double(duration.components.seconds)
            + Double(duration.components.attoseconds) / 1_000_000_000_000_000_000
    }
}
