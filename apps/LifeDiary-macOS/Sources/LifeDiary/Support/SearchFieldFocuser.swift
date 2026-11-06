import AppKit

enum SearchFieldFocuser {
    @discardableResult
    static func focus(in window: NSWindow?) -> Bool {
        guard let window, let root = window.contentView, let field = find(in: root) else { return false }
        return window.makeFirstResponder(field)
    }

    private static func find(in view: NSView) -> NSSearchField? {
        if let field = view as? NSSearchField { return field }
        for child in view.subviews {
            if let field = find(in: child) { return field }
        }
        return nil
    }
}
