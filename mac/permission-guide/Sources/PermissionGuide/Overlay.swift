import AppKit

/// Builds the floating card (overlay.rs, layout.rs content_layout, and
/// overlay-kit's create_nonactivating_panel).
enum Overlay {
    static func makePanel(permission: Permission, app: HostApp, onDismiss: @escaping () -> Void) -> NSPanel {
        let frame = NSRect(x: 0, y: 0, width: Geometry.overlayMaxWidth, height: Geometry.overlayHeight)
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // Status level with a shadow, overlay-kit's default for small chrome:
        // above System Settings, below the menu bar and Notification Center.
        panel.level = .statusBar
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        panel.contentView = makeContent(frame: frame, permission: permission, app: app, onDismiss: onDismiss)
        return panel
    }

    private static func makeContent(frame: NSRect, permission: Permission, app: HostApp,
                                    onDismiss: @escaping () -> Void) -> NSView {
        let content = ContentView(frame: frame)
        let arrow = SketchArrowView(frame: .zero)
        let title = label(permission.title, font: .boldSystemFont(ofSize: 14), color: .labelColor)
        let subtitle = label(permission.subtitle(appName: app.displayName),
                             font: .systemFont(ofSize: 12), color: .secondaryLabelColor)
        let dismiss = DismissButton(frame: .zero)
        dismiss.onClick = onDismiss
        let drag = DragSourceView(app: app)
        let cursor = GuideCursorView()
        drag.guide = cursor
        // A toggle pane has nowhere to drop, so the guide that says "drag me"
        // would be telling the person to do the wrong thing.
        if permission.mode == .toggle { cursor.setVisible(false) }
        for view in [arrow, title, subtitle, dismiss, drag, cursor] as [NSView] {
            content.addSubview(view)
        }
        content.onLayout = { bounds in
            let width = bounds.width
            let height = bounds.height
            // Anarlog's overlay anchors, measured from the top left.
            arrow.frame = NSRect(x: 14, y: 14, width: 44, height: 56)
            let headerWidth = max(width - 56 - 60, 0)
            title.frame = NSRect(x: 56, y: 18, width: headerWidth, height: 20)
            subtitle.frame = NSRect(x: 56, y: 18 + 20 + 2, width: headerWidth, height: 18)
            dismiss.frame = NSRect(x: width - 20 - 24, y: 16, width: 24, height: 24)
            drag.frame = NSRect(x: 16, y: height - 18 - 44, width: max(width - 32, 0), height: 44)
            let size = cursor.intrinsicSize
            cursor.frame = NSRect(x: width / 2 - size.width / 2, y: height / 2 + 2 - size.height / 2,
                                  width: size.width, height: size.height)
        }
        content.onLayout?(content.bounds)
        return content
    }

    private static func label(_ text: String, font: NSFont, color: NSColor) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = font
        field.textColor = color
        field.lineBreakMode = .byTruncatingTail
        return field
    }
}
