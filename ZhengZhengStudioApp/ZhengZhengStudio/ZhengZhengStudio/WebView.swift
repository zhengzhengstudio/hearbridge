import SwiftUI
import WebKit

#if os(macOS)
typealias PlatformViewRepresentable = NSViewRepresentable
#else
typealias PlatformViewRepresentable = UIViewRepresentable
#endif

struct WebView: PlatformViewRepresentable {
    let url: URL

    // --- Common Helper Methods ---
    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        
        #if os(iOS)
        // Enable inline media playback (iOS only)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #endif
        
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        
        // Custom User Agent
        #if os(macOS)
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 SpaceFightMac/1.0"
        #else
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 SpaceFightMobile/1.0"
        #endif
        
        return webView
    }

    private func updateWebView(_ webView: WKWebView) {
        // Only load if the URL has changed or it's the first load
        if webView.url == nil {
            let request = URLRequest(url: url)
            webView.load(request)
        }
    }

    // --- macOS Implementation ---
    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView {
        return makeWebView()
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        updateWebView(nsView)
    }
    #endif

    // --- iOS Implementation ---
    #if os(iOS)
    func makeUIView(context: Context) -> WKWebView {
        return makeWebView()
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        updateWebView(uiView)
    }
    #endif
}
