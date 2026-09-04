import Foundation
import WebKit

enum ClaudeUsageProviderError: LocalizedError, Equatable {
    case requiresSignIn
    case pageUnavailable
    case organizationUnavailable
    case rateLimited
    case unexpectedResponse(Int)
    case invalidPayload

    var errorDescription: String? {
        switch self {
        case .requiresSignIn:
            return "Sign in to Claude to read your usage."
        case .pageUnavailable:
            return "Claude could not be loaded. Check your connection and try again."
        case .organizationUnavailable:
            return "No Claude account with usage information was found."
        case .rateLimited:
            return "Claude is temporarily rate-limiting refreshes. Try again shortly."
        case .unexpectedResponse(let status):
            return "Claude returned an unexpected response (HTTP \(status))."
        case .invalidPayload:
            return "Claude returned usage data in an unsupported format."
        }
    }
}

@MainActor
final class ClaudeWebUsageProvider: NSObject, UsageProviding, WKNavigationDelegate {
    let authenticationWebView: WKWebView

    private var organizationID: String?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        authenticationWebView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        authenticationWebView.navigationDelegate = self
        loadClaudeHome()
    }

    func beginAuthentication() {
        guard let url = URL(string: "https://claude.ai/login") else { return }
        authenticationWebView.load(URLRequest(url: url))
    }

    func fetchUsage() async throws -> UsageSnapshot {
        try await waitUntilNavigationFinishes()

        let id: String
        if let organizationID {
            id = organizationID
        } else {
            let response = try await fetch(path: "/api/organizations")
            try validate(response)
            guard let selected = OrganizationSelector.selectOrganizationID(from: Data(response.body.utf8)) else {
                throw ClaudeUsageProviderError.organizationUnavailable
            }
            organizationID = selected
            id = selected
        }

        let response = try await fetch(path: "/api/organizations/\(id)/usage")
        try validate(response)

        do {
            return try UsagePayloadDecoder.decode(Data(response.body.utf8))
        } catch {
            throw ClaudeUsageProviderError.invalidPayload
        }
    }

    func disconnect() async {
        organizationID = nil
        let dataStore = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        let records = await dataStore.dataRecords(ofTypes: types)
        let claudeRecords = records.filter { record in
            let name = record.displayName.lowercased()
            return name.contains("claude") || name.contains("anthropic")
        }
        await dataStore.removeData(ofTypes: types, for: claudeRecords)
        loadClaudeHome()
    }

    private func loadClaudeHome() {
        guard let url = URL(string: "https://claude.ai/") else { return }
        authenticationWebView.load(URLRequest(url: url))
    }

    private func waitUntilNavigationFinishes() async throws {
        if authenticationWebView.url == nil {
            loadClaudeHome()
        }

        let deadline = Date().addingTimeInterval(20)
        while authenticationWebView.isLoading {
            guard Date() < deadline else {
                throw ClaudeUsageProviderError.pageUnavailable
            }
            try await Task.sleep(for: .milliseconds(100))
        }

        guard authenticationWebView.url != nil else {
            throw ClaudeUsageProviderError.pageUnavailable
        }
    }

    private struct PageResponse {
        let status: Int
        let redirectedToLogin: Bool
        let body: String
    }

    private func fetch(path: String) async throws -> PageResponse {
        let script = """
        const response = await fetch(path, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        const body = await response.text();
        return JSON.stringify({
          status: response.status,
          redirectedToLogin: response.redirected && response.url.includes('/login'),
          body
        });
        """

        let result = try await authenticationWebView.callAsyncJavaScript(
            script,
            arguments: ["path": path],
            in: nil,
            contentWorld: .page
        )

        guard let json = result as? String,
              let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = object["status"] as? Int,
              let body = object["body"] as? String else {
            throw ClaudeUsageProviderError.pageUnavailable
        }

        return PageResponse(
            status: status,
            redirectedToLogin: object["redirectedToLogin"] as? Bool ?? false,
            body: body
        )
    }

    private func validate(_ response: PageResponse) throws {
        if response.redirectedToLogin || response.status == 401 || response.status == 403 {
            organizationID = nil
            throw ClaudeUsageProviderError.requiresSignIn
        }
        if response.status == 429 {
            throw ClaudeUsageProviderError.rateLimited
        }
        guard response.status == 200 else {
            throw ClaudeUsageProviderError.unexpectedResponse(response.status)
        }
    }
}

