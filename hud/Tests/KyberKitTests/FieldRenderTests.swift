import CoreGraphics
import Foundation
import ImageIO
import Metal
import Testing
import UniformTypeIdentifiers

@testable import KyberKit

/// The field, drawn to a texture and saved as a picture, so a change to the
/// shader can be looked at rather than reasoned about.
@Suite("Field render")
struct FieldRenderTests {
    /// The resting uniforms every picture starts from.
    static func base(width: Int, height: Int, rest: Float) -> FieldUniforms {
        FieldUniforms(
            tint: SIMD4(1, 1, 1, 0), pill: SIMD4(0, 0, 0, 0), size: SIMD2(Float(width), Float(height)),
            pointer: SIMD2(-10, -10), agent: SIMD2(-10, -10), parallax: SIMD2(0, 0),
            time: 7.3, act: 5, rest: rest, travel: 12, pulse: 0, beat: 0, alpha: 1, part: 0,
            partRadius: 0.02, partFeather: 0.01, reach: 0, sweep: 99, sweepOrigin: 0, embers: 0, pillOn: 0,
            corner: Float(PresenceFieldRenderer.innerCorner) / 800)
    }

    /// One frame through the whole pipeline, glow and all, over mid grey,
    /// written to `HUD_SNAPSHOT_DIR/field<suffix>.png` when that is set.
    static func render(
        suffix: String = "", voice: [Float] = [], background: Double = 0.42,
        _ adjust: (inout FieldUniforms) -> Void = { _ in }
    ) throws -> Bool {
        // At the backing scale of a Retina display, because the grain is per
        // device pixel and at 1x it is twice the size anyone will see.
        try draw(suffix: suffix, voice: voice, background: background, scale: 2, adjust) != nil
    }

    /// The same frame, handed back as BGRA bytes so a test can measure it.
    /// Nil when this machine has no GPU.
    static func draw(
        suffix: String = "", voice: [Float] = [], background: Double = 0.42, scale: Int = 1,
        _ adjust: (inout FieldUniforms) -> Void = { _ in }
    ) throws -> [UInt8]? {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue()
        else { return nil }
        let pipeline = try FieldPipeline(device: device, format: .bgra8Unorm)

        let width = 1280 * scale, height = 800 * scale
        let textureDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        textureDescriptor.usage = [.renderTarget]
        textureDescriptor.storageMode = .shared
        guard let texture = device.makeTexture(descriptor: textureDescriptor) else { return nil }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        // Mid grey by default, the background the band was tuned against. A
        // negative background clears to transparent, so alpha can be read.
        pass.colorAttachments[0].clearColor = background < 0
            ? MTLClearColorMake(0, 0, 0, 0)
            : MTLClearColorMake(background, background, background, 1)

        // Attentive's depth on an 800 point screen.
        var uniforms = base(
            width: width, height: height, rest: Float(Presence.attentive.field.rest) / 800)
        adjust(&uniforms)
        guard let buffer = queue.makeCommandBuffer() else { return nil }
        pipeline.encode(
            buffer, into: pass, width: width, height: height, uniforms: &uniforms, voice: voice)
        buffer.commit()
        buffer.waitUntilCompleted()
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        texture.getBytes(
            &pixels, bytesPerRow: width * 4,
            from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        guard let directory = ProcessInfo.processInfo.environment["HUD_SNAPSHOT_DIR"] else {
            return pixels
        }
        let measured = pixels
        let space = CGColorSpaceCreateDeviceRGB()
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue)
            .union(.byteOrder32Little)
        guard let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: space, bitmapInfo: info.rawValue),
            let image = context.makeImage()
        else { return nil }
        let url = URL(fileURLWithPath: directory).appendingPathComponent("field\(suffix).png")
        guard let sink = CGImageDestinationCreateWithURL(
            url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(sink, image, nil)
        return CGImageDestinationFinalize(sink) ? measured : nil
    }

    @Test("the band at rest draws, and can be looked at")
    func atRest() throws {
        // No GPU is a machine this package cannot draw on, not a broken
        // shader; `render` says so by returning false without throwing.
        _ = try Self.render()
    }

    @Test("acting: green in the strands, sparks, and a finger toward the agent")
    func acting() throws {
        _ = try Self.render(suffix: "-acting") {
            $0.tint = SIMD4(0.28, 1.45, 0.55, 0.60)
            $0.rest = 12 / 800
            $0.embers = 1
            $0.agent = SIMD2(0.72, 0.62)
            $0.reach = 1
        }
    }

    @Test("the voice leaves the hyper bar as ripples")
    func ripples() throws {
        // A syllable, a gap and another, newest first.
        let voice: [Float] = (0..<32).map { i in
            let t = Float(i)
            return max(0, sin(t * 0.55)) * (i < 20 ? 0.9 : 0.4)
        }
        _ = try Self.render(suffix: "-voice", voice: voice) { $0.rest = 6 / 800 }
    }

    @Test("done sends one crest round the band")
    func sweep() throws {
        _ = try Self.render(suffix: "-done") {
            $0.tint = SIMD4(0.14, 0.62, 0.30, 0.75)
            $0.rest = 9 / 800
            $0.sweep = 0.45
            $0.sweepOrigin = 0.62
        }
    }

    @Test("the hyper bar is a capsule of the band's own titanium")
    func bar() throws {
        // 300 by 34 points, centred, 14 above a 70 point Dock, on 1280 by 800.
        _ = try Self.render(suffix: "-bar") {
            $0.pill = SIMD4(490 / 1280, 682 / 800, 300 / 1280, 34 / 800)
            $0.pillOn = 1
            $0.tint = SIMD4(0.28, 1.45, 0.55, 0.60)
            $0.rest = 26 / 800
        }
    }

    @Test("thinking: a scanning streak on the cut edge")
    func thinking() throws {
        _ = try Self.render(suffix: "-thinking") {
            $0.rest = 8 / 800
            $0.drift = 3.2
        }
    }

    /// Six frames of thinking a fifth of a second apart, for judging the
    /// motion before an install. Drift 3.2 advances `travel` 3.2 a second.
    @Test("thinking, as a strip of frames")
    func thinkingStrip() throws {
        for frame in 0..<6 {
            let seconds = Float(frame) * 0.2
            _ = try Self.render(suffix: "-strip\(frame)") {
                $0.rest = 8 / 800
                $0.drift = 3.2
                $0.time += seconds
                $0.travel += 3.2 * seconds
            }
        }
    }

    /// The second look scattered specks past the band's edge into the screen,
    /// and on screen that read as "fairy dust" (2026-10-04). Nothing may be
    /// drawn further in than the band plus its seating shadow, at rest or
    /// acting, which is the state that used to lift sparks.
    @Test("nothing is drawn inside the screen past the band")
    func noDust() throws {
        let width = 1280, height = 800
        for (rest, embers) in [(Float(9), Float(0)), (Float(12), Float(1)), (Float(20), Float(1))] {
            guard let pixels = try Self.draw(suffix: "-nodust", background: -1, { $0.rest = rest / 800; $0.embers = embers })
            else { return }
            // Band, its 10% swell from a voice that is not there, the 2.4 px
            // shadow, and a pixel of antialiasing.
            let limit = Int(rest * 1.1) + 4
            var stray = 0
            for y in (limit + 40)..<(height - limit - 40) {
                for x in (limit + 1)..<(width - limit - 1) where pixels[(y * width + x) * 4 + 3] > 5 {
                    stray += 1
                }
            }
            #expect(stray == 0)
        }
    }

    @Test("the bezel still reads over a white page")
    func overLight() throws {
        _ = try Self.render(suffix: "-light", background: 0.97)
    }

    /// Asked for on 2026-10-04 as "linear all the way around", and on
    /// 2026-10-09 as "equal size on all sides": the titanium frame it replaced
    /// was 58 points at the top and 80 at the bottom on a notched MacBook
    /// against 20 on the sides, because it wrapped the menu bar and the Dock.
    /// This counts how many pixels in from each edge's midpoint the glass
    /// reaches. Colour rather than alpha, because the contact shadow past the
    /// inner edge has alpha and no colour, and white glass has both.
    @Test("the rim is one depth on all four sides")
    func straight() throws {
        let width = 1280, height = 800
        guard let pixels = try Self.draw(suffix: "-alpha", background: -1, { $0.travel = 0 })
        else { return }
        func lit(x: Int, y: Int) -> Bool { pixels[(y * width + x) * 4 + 2] > 8 }
        func reach(from start: (Int, Int), step: (Int, Int)) -> Int {
            var (x, y) = start, n = 0
            while lit(x: x, y: y) && n < 100 { x += step.0; y += step.1; n += 1 }
            return n
        }
        let left = reach(from: (0, height / 2), step: (1, 0))
        let right = reach(from: (width - 1, height / 2), step: (-1, 0))
        let top = reach(from: (width / 2, 0), step: (0, 1))
        let bottom = reach(from: (width / 2, height - 1), step: (0, -1))
        let rest = Int(Presence.attentive.field.rest)
        for side in [left, right, top, bottom] {
            #expect(abs(side - rest) <= 1, "a side reached \(side) px, attentive is \(rest)")
        }
        // Past the inner edge and its shadow, the screen is untouched.
        #expect(pixels[((height / 2) * width + 40) * 4 + 3] == 0)
    }

    /// "Not transparent enough", 2026-10-09: the titanium face was opaque.
    /// The glass between the edge and the cut line has to let the screen
    /// read through it, so its coverage stays well under half.
    @Test("the glass is see-through")
    func seeThrough() throws {
        let width = 1280, height = 800
        guard let pixels = try Self.draw(background: -1, { $0.travel = 0 }) else { return }
        // Two pixels in from the left edge, clear of the cut line, at three
        // heights so the light from above is in the reading.
        for y in [height / 4, height / 2, 3 * height / 4] {
            let alpha = Double(pixels[(y * width + 2) * 4 + 3]) / 255
            #expect(alpha > 0.05 && alpha < 0.35, "coverage \(alpha) at y \(y)")
        }
    }
}
