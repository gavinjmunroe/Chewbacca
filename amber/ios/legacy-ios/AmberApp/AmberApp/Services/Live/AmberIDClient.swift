import Foundation

/// Thin HTTP client for the deployed amber-id Railway service.
///
/// amber-id is the identity vault: account lifecycle (create/delete),
/// Privy verification, profile data, privacy tiers, and the knowledge base.
/// amber-agent handles AI chat, contacts, and graph features and proxies a
/// few amber-id reads, but anything that mutates identity state must go
/// directly to amber-id.
///
/// The HTTP shape is identical to `AmberAgentClient`; we keep them as
/// separate types so call sites are explicit about which service they
/// target and so request/response evolution is decoupled.
actor AmberIDClient {
    let baseURL: URL
    let session: URLSession
    private let tokenProvider: @Sendable () async throws -> String
    private let crash: any CrashService
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(
        baseURL: URL,
        session: URLSession = .shared,
        crash: any CrashService,
        tokenProvider: @escaping @Sendable () async throws -> String
    ) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
        self.crash = crash
        self.decoder = JSONDecoder()
        self.decoder.keyDecodingStrategy = .convertFromSnakeCase
        self.encoder = JSONEncoder()
        self.encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try await request(method: "GET", path: path, query: query, body: Optional<String>.none)
    }

    func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        try await request(method: "POST", path: path, query: [], body: body)
    }

    @discardableResult
    func postVoid<Body: Encodable>(_ path: String, body: Body) async throws -> EmptyResponse {
        try await request(method: "POST", path: path, query: [], body: body)
    }

    private func request<T: Decodable, Body: Encodable>(
        method: String,
        path: String,
        query: [URLQueryItem],
        body: Body?
    ) async throws -> T {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw AmberServiceError.unknown
        }
        components.path += path.hasPrefix("/") ? path : "/\(path)"
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw AmberServiceError.unknown }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let token = try await tokenProvider()
            if !token.isEmpty {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        } catch {
            throw AmberServiceError.unauthenticated
        }

        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch let error as URLError where error.code == .notConnectedToInternet || error.code == .timedOut {
            crash.record(error, context: ["service": "amber-id", "path": path])
            throw AmberServiceError.offline
        } catch {
            crash.record(error, context: ["service": "amber-id", "path": path])
            throw AmberServiceError.unknown
        }

        guard let http = response as? HTTPURLResponse else { throw AmberServiceError.unknown }

        switch http.statusCode {
        case 200..<300:
            if T.self == EmptyResponse.self { return EmptyResponse() as! T }
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                crash.record(error, context: [
                    "service": "amber-id",
                    "path": path,
                    "body": String(data: data, encoding: .utf8) ?? ""
                ])
                throw AmberServiceError.decoding
            }
        case 401:
            throw AmberServiceError.unauthenticated
        case 412:
            throw AmberServiceError.cnftRequired
        case 429:
            throw AmberServiceError.rateLimited
        default:
            struct Body: Decodable { let error: String?; let message: String? }
            let message = (try? decoder.decode(Body.self, from: data).message)
                ?? "amber-id request failed with status \(http.statusCode)."
            throw AmberServiceError.server(message: message, status: http.statusCode)
        }
    }
}
