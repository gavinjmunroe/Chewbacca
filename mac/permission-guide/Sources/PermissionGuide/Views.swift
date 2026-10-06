import AppKit
import QuartzCore

/// Everything drawn on the card. Each class is a port of the Anarlog view of
/// the same role in plugins/permissions/src/assistant/macos/views/.

/// The card itself (content.rs): window background, 12 point continuous
/// corners, a hairline border at a third of the separator color.
final class ContentView: NSView {
    var onLayout: ((NSRect) -> Void)?

    override init(frame: NSRect) {
        super.init(frame: frame)
        autoresizesSubviews = true
        wantsLayer = true
        applyLayerStyle()
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }

    override func viewDidChangeEffectiveAppearance() {
        applyLayerStyle()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        onLayout?(bounds)
    }

    private func applyLayerStyle() {
        guard let layer else { return }
        Theme.continuousCorner(layer, 12)
        layer.masksToBounds = true
        layer.borderWidth = 0.5
        Theme.resolving(self) {
            layer.backgroundColor = NSColor.windowBackgroundColor.cgColor
            layer.borderColor = NSColor.separatorColor.withAlphaComponent(0.35).cgColor
        }
    }
}

/// The loose hand-drawn arrow curving up toward the list (sketch_arrow.rs).
/// Shaft and head are one path stroked once, so where it crosses itself it is
/// painted once instead of compositing into a darker patch, and the color is
/// opaque for the same reason.
final class SketchArrowView: NSView {
    override var isFlipped: Bool { true }

    override func viewDidChangeEffectiveAppearance() {
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemGray.set()
        let size = bounds.size
        func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
            NSPoint(x: bounds.minX + x * size.width, y: bounds.minY + y * size.height)
        }
        let path = NSBezierPath()
        path.move(to: point(0.62, 0.94))
        path.curve(to: point(0.42, 0.54), controlPoint1: point(0.66, 0.78), controlPoint2: point(0.34, 0.68))
        path.curve(to: point(0.44, 0.10), controlPoint1: point(0.48, 0.38), controlPoint2: point(0.50, 0.20))
        path.line(to: point(0.22, 0.22))
        path.move(to: point(0.44, 0.10))
        path.line(to: point(0.60, 0.26))
        path.lineWidth = 2.4
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.stroke()
    }
}

/// The switch on the app row (decorative_switch.rs): always on, never
/// interactive, so a click anywhere on the row starts the drag.
final class DecorativeSwitch: NSSwitch {
    override init(frame: NSRect) {
        super.init(frame: frame)
        state = .on
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// The capsule close button (dismiss_button.rs).
final class DismissButton: NSView {
    // Anarlog's fill: the label color at 6 percent, 12 on hover.
    private static let idleAlpha: CGFloat = 0.06
    private static let hoverAlpha: CGFloat = 0.12

    var onClick: (() -> Void)?
    private var hovered = false
    private let glyph = NSImageView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        toolTip = "Dismiss"
        setAccessibilityLabel("Dismiss")
        setAccessibilityRole(.button)
        let config = NSImage.SymbolConfiguration(pointSize: 10, weight: NSFont.Weight(rawValue: 0.4))
        glyph.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: nil)?
            .withSymbolConfiguration(config)
        glyph.contentTintColor = .secondaryLabelColor
        glyph.imageScaling = .scaleNone
        addSubview(glyph)
        addTrackingArea(NSTrackingArea(rect: .zero,
                                       options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
        applyFill(animated: false)
    }

    required init?(coder: NSCoder) { nil }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        glyph.frame = bounds
        layer?.cornerRadius = min(newSize.width, newSize.height) / 2
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidChangeEffectiveAppearance() {
        applyFill(animated: false)
    }

    override func mouseEntered(with event: NSEvent) {
        hovered = true
        applyFill(animated: true)
    }

    override func mouseExited(with event: NSEvent) {
        hovered = false
        applyFill(animated: true)
    }

    override func mouseDown(with event: NSEvent) {}

    override func mouseUp(with event: NSEvent) {
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onClick?() }
    }

    private func applyFill(animated: Bool) {
        guard let layer else { return }
        var color = NSColor.clear
        Theme.resolving(self) {
            color = NSColor.labelColor.withAlphaComponent(hovered ? Self.hoverAlpha : Self.idleAlpha)
        }
        if animated {
            Motion.animateBackground(layer, to: color, duration: Motion.hoverDuration)
        } else {
            layer.backgroundColor = color.cgColor
        }
    }
}

/// The hatched slot left behind while the row is being dragged (drag_source.rs
/// DragPlaceholderView), so the card still shows where the app came from.
final class DragPlaceholderView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        autoresizingMask = [.width, .height]
        isHidden = true
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidChangeEffectiveAppearance() {
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        let dark = Theme.isDark(self)
        let inner = bounds.insetBy(dx: 2.5, dy: 2.5)
        let radius: CGFloat = 8
        Theme.dragRowBackground(dark: dark, hovered: false)
            .withAlphaComponent(dark ? 0.05 : 0.10).setFill()
        NSBezierPath(roundedRect: inner, xRadius: radius, yRadius: radius).fill()
        Hatch.stroke(inner, radius: radius,
                     color: NSColor.systemGray.withAlphaComponent(dark ? 0.30 : 0.22))
        NSColor.systemGray.withAlphaComponent(dark ? 0.68 : 0.52).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), xRadius: radius, yRadius: radius)
        border.lineWidth = 1.6
        border.stroke()
    }
}

/// overlay-kit's stroke_hatch: a clipped diagonal hatch with a small
/// deterministic wobble per line so it reads as drawn by hand.
enum Hatch {
    static let spacing: CGFloat = 8
    static let lineWidth: CGFloat = 1.2
    static let angleDegrees: CGFloat = 45
    static let jitterAmount: CGFloat = 0.16

    static func stroke(_ rect: NSRect, radius: CGFloat, color: NSColor) {
        guard let context = NSGraphicsContext.current else { return }
        context.saveGraphicsState()
        NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).addClip()
        color.setStroke()
        let dx = rect.height / tan(angleDegrees * .pi / 180)
        var x = rect.minX - abs(dx)
        var index = 0
        while x <= rect.maxX + abs(dx) {
            let path = NSBezierPath()
            path.lineWidth = lineWidth
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            path.move(to: NSPoint(x: x + jitter(index, 0), y: rect.minY + jitter(index, 1)))
            path.line(to: NSPoint(x: x + dx + jitter(index, 2), y: rect.maxY + jitter(index, 3)))
            path.stroke()
            index += 1
            x += spacing
        }
        context.restoreGraphicsState()
    }

    private static func jitter(_ seed: Int, _ offset: Int) -> CGFloat {
        let hash = (seed &* 17 &+ offset) &* 13
        let normalized = CGFloat(hash % 5) / 4
        return (normalized * 2 - 1) * jitterAmount
    }
}

/// The app row and its icon, label and switch (drag_source.rs build_row_view).
final class AppRowView: NSView {
    private let iconChrome = NSView()
    private let iconView: NSImageView
    private let label: NSTextField
    private let toggle = DecorativeSwitch(frame: .zero)

    init(app: HostApp) {
        iconView = NSImageView(image: app.icon)
        label = NSTextField(labelWithString: app.displayName)
        super.init(frame: .zero)
        wantsLayer = true
        autoresizingMask = [.width, .height]
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconChrome.wantsLayer = true
        if let layer = iconChrome.layer {
            Theme.continuousCorner(layer, 6)
            layer.masksToBounds = true
        }
        iconChrome.addSubview(iconView)
        // Weight 0.23 is Anarlog's, between medium and semibold.
        label.font = .systemFont(ofSize: 14, weight: NSFont.Weight(rawValue: 0.23))
        label.textColor = .labelColor
        label.lineBreakMode = .byTruncatingTail
        addSubview(iconChrome)
        addSubview(label)
        addSubview(toggle)
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        // Row: 12 point side padding, 26 icon chrome, 6 gap, label fills, 10
        // gap, 38 by 22 switch, all centered vertically.
        let midY = newSize.height / 2
        iconChrome.frame = NSRect(x: 12, y: midY - 13, width: 26, height: 26)
        iconView.frame = NSRect(x: 2, y: 2, width: 22, height: 22)
        let toggleX = newSize.width - 12 - 38
        toggle.frame = NSRect(x: toggleX, y: midY - 11, width: 38, height: 22)
        let labelX = iconChrome.frame.maxX + 6
        label.frame = NSRect(x: labelX, y: midY - 10, width: max(toggleX - 10 - labelX, 0), height: 20)
    }
}

/// The yellow row the person drags into the System Settings list.
///
/// It is a real drag source: the pasteboard item carries only the app's file
/// URL, which is the single type the Privacy lists accept on a drop. Anarlog
/// provides it lazily through a data provider rather than writing an NSURL,
/// and this keeps that, so nothing else rides along on the pasteboard.
final class DragSourceView: NSView, NSDraggingSource, NSPasteboardItemDataProvider {
    private let bundleURL: URL
    private let placeholder = DragPlaceholderView(frame: .zero)
    private let row: AppRowView
    private var interaction = DragInteraction()
    weak var guide: GuideCursorView? {
        didSet { updateGuide() }
    }

    init(app: HostApp) {
        bundleURL = app.bundleURL
        row = AppRowView(app: app)
        super.init(frame: .zero)
        addSubview(placeholder)
        addSubview(row)
        addTrackingArea(NSTrackingArea(rect: .zero,
                                       options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
        applyRowAppearance(animated: false)
    }

    required init?(coder: NSCoder) { nil }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        placeholder.frame = bounds
        row.frame = bounds
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidChangeEffectiveAppearance() {
        applyRowAppearance(animated: false)
        placeholder.needsDisplay = true
    }

    override func mouseEntered(with event: NSEvent) {
        interaction.hovered = true
        applyRowAppearance(animated: true)
        updateGuide()
    }

    override func mouseExited(with event: NSEvent) {
        interaction.hovered = false
        applyRowAppearance(animated: true)
        updateGuide()
    }

    override func mouseDown(with event: NSEvent) {
        let item = NSPasteboardItem()
        item.setDataProvider(self, forTypes: [.fileURL])
        let draggingItem = NSDraggingItem(pasteboardWriter: item)
        draggingItem.setDraggingFrame(convert(row.frame, from: row.superview), contents: snapshot())
        let session = beginDraggingSession(with: [draggingItem], event: event, source: self)
        session.animatesToStartingPositionsOnCancelOrFail = true
    }

    func pasteboard(_ pasteboard: NSPasteboard?, item: NSPasteboardItem,
                    provideDataForType type: NSPasteboard.PasteboardType) {
        guard type == .fileURL else { return }
        item.setData(bundleURL.dataRepresentation, forType: type)
    }

    func draggingSession(_ session: NSDraggingSession,
                         sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        .copy
    }

    func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) {
        interaction.dragging = true
        placeholder.isHidden = false
        row.isHidden = true
        updateGuide()
    }

    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint,
                         operation: NSDragOperation) {
        interaction.dragging = false
        if operation.contains(.copy) { interaction.completed = true }
        placeholder.isHidden = true
        row.isHidden = false
        updateGuide()
    }

    private func updateGuide() {
        guide?.setVisible(interaction.guideVisible)
    }

    private func applyRowAppearance(animated: Bool) {
        guard let layer = row.layer else { return }
        // Tighter than the card's 12 so the row nests concentrically inside
        // the card's corner instead of pinching the gap there.
        Theme.continuousCorner(layer, 8)
        layer.borderWidth = 0
        let color = Theme.dragRowBackground(dark: Theme.isDark(self), hovered: interaction.hovered)
        if animated {
            Motion.animateBackground(layer, to: color, duration: Motion.hoverDuration)
        } else {
            layer.backgroundColor = color.cgColor
        }
    }

    private func snapshot() -> NSImage {
        let bounds = row.bounds
        let image = NSImage(size: bounds.size)
        if let rep = row.bitmapImageRepForCachingDisplay(in: bounds) {
            row.cacheDisplay(in: bounds, to: rep)
            image.addRepresentation(rep)
        }
        return image
    }
}

/// interaction.rs: the guide shows until the person hovers, drags, or drops
/// once, and never comes back after a completed drop.
struct DragInteraction {
    var hovered = false
    var dragging = false
    var completed = false

    var guideVisible: Bool { !hovered && !dragging && !completed }
}

/// A faux grab cursor with a pulsing ring behind it, floating over the row's
/// top edge to say "put the mouse here and drag" (guide_cursor.rs). It uses
/// the real system open-hand image so it matches the pointer they will see.
final class GuideCursorView: NSView {
    private let pulse = CALayer()
    private var visible = true
    let intrinsicSize: NSSize

    init() {
        let image = NSCursor.openHand.image
        intrinsicSize = image.size
        super.init(frame: NSRect(origin: .zero, size: image.size))
        wantsLayer = true
        guard let root = layer else { return }
        let size = image.size
        let center = CGPoint(x: size.width / 2, y: size.height / 2)

        // The ring, added first so it renders behind the cursor.
        let diameter = max(size.width, size.height) * 1.05
        pulse.bounds = CGRect(x: 0, y: 0, width: diameter, height: diameter)
        pulse.position = center
        pulse.cornerRadius = diameter / 2
        pulse.borderWidth = 2
        Self.addPulse(to: pulse)
        root.addSublayer(pulse)
        applyPulseStyle()

        let cursor = CALayer()
        cursor.bounds = CGRect(origin: .zero, size: size)
        cursor.position = center
        cursor.contentsScale = 2
        cursor.contents = image
        cursor.shadowColor = NSColor.black.cgColor
        cursor.shadowOpacity = 0.3
        cursor.shadowRadius = 2.5
        cursor.shadowOffset = CGSize(width: 0, height: -1.5)
        root.addSublayer(cursor)
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidChangeEffectiveAppearance() {
        applyPulseStyle()
    }

    func setVisible(_ newValue: Bool) {
        guard visible != newValue else { return }
        visible = newValue
        guard let root = layer else {
            isHidden = !newValue
            return
        }
        if newValue {
            isHidden = false
            Motion.fade(root, from: 0, to: 1, duration: Motion.fadeDuration, key: "guideVisibility")
            return
        }
        Motion.fade(root, from: root.opacity, to: 0, duration: Motion.fadeDuration, key: "guideVisibility") {
            [weak self] in
            self?.isHidden = true
            self?.layer?.opacity = 1
        }
    }

    private func applyPulseStyle() {
        Theme.resolving(self) {
            let accent = NSColor.controlAccentColor
            pulse.borderColor = accent.withAlphaComponent(0.9).cgColor
            pulse.backgroundColor = accent.withAlphaComponent(0.16).cgColor
        }
    }

    /// Expand from 0.66 to 1.9 while fading from 0.55 to nothing, every 1.5
    /// seconds, forever: Anarlog's attention pulse.
    private static func addPulse(to layer: CALayer) {
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.66
        scale.toValue = 1.9
        scale.duration = 1.5
        scale.repeatCount = .infinity
        scale.timingFunction = Motion.easeOut
        layer.add(scale, forKey: "pulseScale")

        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.55
        fade.toValue = 0
        fade.duration = 1.5
        fade.repeatCount = .infinity
        fade.timingFunction = Motion.easeOut
        layer.add(fade, forKey: "pulseOpacity")
    }
}
