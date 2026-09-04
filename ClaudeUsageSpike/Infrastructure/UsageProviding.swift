import WebKit

@MainActor
protocol UsageProviding: AnyObject {
    var authenticationWebView: WKWebView { get }

    func beginAuthentication()
    func fetchUsage() async throws -> UsageSnapshot
    func disconnect() async
}

