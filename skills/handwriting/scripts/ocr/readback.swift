// Read handwriting back with Apple's Vision framework, accurate mode.
// usage: readback <image> ...   prints one line of recognized text per image
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print(""); continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([req])
    let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    print(text)
}
