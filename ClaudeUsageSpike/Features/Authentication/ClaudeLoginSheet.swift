import SwiftUI
import WebKit

struct ClaudeLoginSheet: View {
    let webView: WKWebView
    let onCancel: () -> Void
    let onDone: () -> Void

    var body: some View {
        NavigationStack {
            ClaudeLoginWebView(webView: webView)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Sign in to Claude")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: onCancel)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: onDone)
                    }
                }
        }
    }
}

private struct ClaudeLoginWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

