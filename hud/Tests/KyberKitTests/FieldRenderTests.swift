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
            partRadius: 0.02, partFeather: 0.01, reach: 0, sweep: 99, sweepOrigin: 0, embers: 0, pillOn: 0)
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

        // 20 points on an 800 point screen: attentive.
        var uniforms = base(width: width, height: height, rest: 20 / 800)
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
            $0.rest = 26 / 800
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
        _ = try Self.render(suffix: "-voice", voice: voice) { $0.rest = 9 / 800 }
    }

    @Test("done sends one crest round the band")
    func sweep() throws {
        _ = try Self.render(suffix: "-done") {
            $0.tint = SIMD4(0.14, 0.62, 0.30, 0.75)
            $0.rest = 16 / 800
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

    @Test("thinking: a scanning streak on the bevel")
    func thinking() throws {
        _ = try Self.render(suffix: "-thinking") {
            $0.rest = 11 / 800
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
                $0.rest = 11 / 800
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
        for (rest, embers) in [(Float(20), Float(0)), (Float(26), Float(1))] {
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

    @Test("the band starts under the menu bar, not behind it")
    func underMenuBar() throws {
        // A 37 point menu bar, the height on a notched MacBook.
        _ = try Self.render(suffix: "-menubar") { $0.top = 37 / 800 }
    }

    @Test("the bezel still reads over a white page")
    func overLight() throws {
        _ = try Self.render(suffix: "-light", background: 0.97)
    }

    /// Asked for on 2026-10-04 as "linear all the way around". The liquid band
    /// it replaced pooled in the corners and bulged along the sides, so this
    /// measures the band's opacity at one inset from the glass: middle of the
    /// left edge, middle of the top, and the same inset along a corner's
    /// diagonal. Opacity and not colour, because wherever the travelling light
    /// is the grain is bright enough to match a white page. Grain varies pixel
    /// to pixel, so each reading is the mean of a small patch.
    @Test("the band is one thickness on the sides and round the corners")
    func straight() throws {
        let width = 1280, height = 800
        guard let pixels = try Self.draw(suffix: "-alpha", background: -1) else { return }
        func coverage(x: Int, y: Int) -> Double {
            var sum = 0.0, count = 0.0
            for dy in -3...3 {
                for dx in -3...3 {
                    let i = ((y + dy) * width + (x + dx)) * 4
                    sum += Double(pixels[i + 3]) / 255
                    count += 1
                }
            }
            return sum / count
        }
        // 5 pixels in, inside a 20 pixel band: all three should be bezel.
        let left = coverage(x: 5, y: height / 2)
        let top = coverage(x: width / 2, y: 5)
        // Round the corner the distance is to a circle of radius depth plus
        // 0.012 heights, 29.6 px here, centred 29.6 px in on both axes, so
        // (12, 12) sits about 4.7 px inside the glass.
        let corner = coverage(x: 12, y: 12)
        // Past the inner edge and the dust, the screen is untouched.
        let inside = coverage(x: 60, y: height / 2)
        #expect(left > 0.5)
        #expect(abs(left - top) < 0.12)
        #expect(abs(left - corner) < 0.12)
        #expect(inside < 0.02)
    }
}
