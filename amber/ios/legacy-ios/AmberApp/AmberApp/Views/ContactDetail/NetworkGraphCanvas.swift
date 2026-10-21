import SwiftUI

/// Force-directed-ish node-link view of the caller's network. The layout is
/// a simple circular placement with the self node at the center, sized by
/// edge weight, and the warm path highlighted in amber signature yellow.
///
/// This is deliberately not a physics simulation. It renders quickly, looks
/// good at the demo's card size, and stays readable under Reduce Motion.
struct NetworkGraphCanvas: View {
    let graph: NetworkGraph
    let highlightedPath: [UUID]
    var selfLabel: String = "You"

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse: CGFloat = 0

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width, proxy.size.height)
            let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
            let radius = size / 2.4

            let layout = layoutNodes(center: center, radius: radius)

            ZStack {
                edges(layout: layout)
                nodes(layout: layout)
                selfNode(center: center)
            }
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
                    pulse = 1
                }
            }
        }
        .frame(height: 280)
        .accessibilityElement()
        .accessibilityLabel(accessibilitySummary)
    }

    private var accessibilitySummary: Text {
        let names = graph.nodes.prefix(6).map { $0.name }.joined(separator: ", ")
        return Text("Network graph. You, connected to \(names).")
    }

    private func layoutNodes(center: CGPoint, radius: CGFloat) -> [UUID: CGPoint] {
        var result: [UUID: CGPoint] = [:]
        let orbit = graph.nodes.filter { $0.id != graph.selfContactId }
        for (idx, node) in orbit.enumerated() {
            let angle = (2 * .pi / CGFloat(max(orbit.count, 1))) * CGFloat(idx) - .pi / 2
            let weight = maxEdgeWeight(forNode: node.id)
            let r = radius * (0.7 + 0.3 * CGFloat(weight))
            let x = center.x + cos(angle) * r
            let y = center.y + sin(angle) * r
            result[node.id] = CGPoint(x: x, y: y)
        }
        result[graph.selfContactId] = center
        return result
    }

    private func maxEdgeWeight(forNode id: UUID) -> Double {
        graph.edges
            .filter { $0.from == id || $0.to == id }
            .map(\.weight).max() ?? 0.5
    }

    private func edges(layout: [UUID: CGPoint]) -> some View {
        Canvas { context, _ in
            for edge in graph.edges {
                guard let from = layout[edge.from], let to = layout[edge.to] else { continue }
                let inPath = highlightedPath.contains(edge.from) && highlightedPath.contains(edge.to)
                let color: Color = inPath ? .amberSignature : .white.opacity(0.22 + 0.3 * edge.weight)
                var path = Path()
                path.move(to: from)
                path.addLine(to: to)
                let width = CGFloat(0.6 + edge.weight * 1.8) * (inPath ? 1.4 : 1)
                context.stroke(path, with: .color(color), lineWidth: width)
            }
        }
    }

    private func nodes(layout: [UUID: CGPoint]) -> some View {
        ForEach(graph.nodes.filter { $0.id != graph.selfContactId }) { node in
            if let pos = layout[node.id] {
                let isHighlighted = highlightedPath.contains(node.id)
                ZStack {
                    Circle()
                        .fill(node.avatarColor.opacity(isHighlighted ? 0.95 : 0.75))
                        .frame(width: nodeSize(for: node), height: nodeSize(for: node))
                        .overlay(
                            Circle().strokeBorder(
                                isHighlighted ? Color.amberSignature : Color.white.opacity(0.12),
                                lineWidth: isHighlighted ? 2 : 0.5
                            )
                        )
                        .shadow(color: isHighlighted ? Color.amberSignature.opacity(0.5) : .clear, radius: 10)

                    Text(node.initials)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                }
                .position(pos)
                .accessibilityLabel(Text("\(node.name), \(node.mutualCount) mutual"))
            }
        }
    }

    private func selfNode(center: CGPoint) -> some View {
        ZStack {
            Circle()
                .fill(Color.amberSignature.opacity(0.18))
                .frame(width: 68 + pulse * 6, height: 68 + pulse * 6)
            Circle()
                .fill(Color.amberSignature)
                .frame(width: 44, height: 44)
                .shadow(color: Color.amberSignature.opacity(0.55), radius: 14)
            Text(selfLabel)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.black)
        }
        .position(center)
    }

    private func nodeSize(for node: NetworkContact) -> CGFloat {
        let base: CGFloat = 36
        let weight = min(max(CGFloat(node.mutualCount) / 12.0, 0.4), 1.3)
        return base * weight
    }
}
