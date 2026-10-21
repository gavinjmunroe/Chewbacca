import Foundation

/// Real Ask Amber implementation. Hits `POST /api/ask` on amber-agent, which
/// proxies to amber-id `/ask` which runs the people-centric Q&A pipeline
/// (Pinecone + PeopleRank + Perplexity synthesis).
actor LiveChatService: AmberChatService {
    private let client: AmberAgentClient

    init(client: AmberAgentClient) {
        self.client = client
    }

    struct AskRequest: Encodable {
        let question: String
        let topK: Int?
        let filter: [String: String]?
    }

    struct AskResponse: Decodable {
        let ok: Bool?
        let answer: String
        let people: [AmberAskPerson]
        let citations: [AmberAskCitation]
        let dimensionWeights: [String: Double]?
        let model: String?
        let usedPeopleRank: Bool?
        let tookMs: Int?
    }

    func ask(question: String, topK: Int?, filter: [String: String]?) async throws -> AmberAnswerPayload {
        let resp: AskResponse = try await client.post("/api/ask", body: AskRequest(question: question, topK: topK, filter: filter))
        return AmberAnswerPayload(
            answer: resp.answer,
            people: resp.people,
            citations: resp.citations,
            dimensionWeights: resp.dimensionWeights,
            model: resp.model ?? "sonar-pro",
            usedPeopleRank: resp.usedPeopleRank ?? false,
            tookMs: resp.tookMs
        )
    }

    func suggestions() async throws -> [NetworkSuggestion] {
        struct Resp: Decodable { let suggestions: [String] }
        do {
            let resp: Resp = try await client.get("/api/suggestions")
            return resp.suggestions.map { NetworkSuggestion(label: $0) }
        } catch {
            return []
        }
    }
}
