//
//  APIClient.swift
//  AmberApp
//
//  Created on 2026-03-04.
//

import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case badRequest(String)
    case notFound(String)
    case serverError(Int, String)
    case decodingError(String)
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Session expired. Please log in again."
        case .badRequest(let message):
            return message
        case .notFound(let message):
            return message
        case .serverError(let code, let message):
            return "Server error (\(code)): \(message)"
        case .decodingError(let detail):
            return "Failed to parse response: \(detail)"
        case .networkError(let message):
            return message
        }
    }
}

final class APIClient {
    static let shared = APIClient()

    var baseURL: String? = AppConfig.apiBaseURL
    var accessToken: String?

    private let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)

        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    // MARK: - Onboarding

    func startOnboarding() async throws -> OnboardingResponse {
        try await post("/onboarding/start")
    }

    func submitOnboardingStep(step: String, data: [String: Any]) async throws -> OnboardingStepResponse {
        try await put("/onboarding/step/\(step)", body: data)
    }

    func completeOnboarding() async throws -> ProfileResponse {
        try await post("/onboarding/complete")
    }

    func getOnboardingStatus() async throws -> OnboardingStatusResponse {
        try await get("/onboarding/status")
    }

    // MARK: - Profile

    func getProfile() async throws -> ProfileResponse {
        try await get("/profile")
    }

    func updateProfile(data: [String: Any]) async throws -> ProfileResponse {
        try await put("/profile", body: data)
    }

    // MARK: - HTTP Methods

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let request = try buildRequest(method: "GET", path: path)
        return try await execute(request)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any]? = nil) async throws -> T {
        var request = try buildRequest(method: "POST", path: path)
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await execute(request)
    }

    private func put<T: Decodable>(_ path: String, body: [String: Any]? = nil) async throws -> T {
        var request = try buildRequest(method: "PUT", path: path)
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await execute(request)
    }

    // MARK: - Request Building

    private func buildRequest(method: String, path: String) throws -> URLRequest {
        guard let baseURL, let url = URL(string: baseURL + path) else {
            throw APIError.networkError("No backend configured (simulator mode)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        guard let token = accessToken else {
            throw APIError.unauthorized
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        return request
    }

    // MARK: - Execution

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.networkError(error.localizedDescription)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200...201:
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error.localizedDescription)
            }
        case 401:
            throw APIError.unauthorized
        case 400:
            if let errorBody = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.badRequest(errorBody.message)
            }
            throw APIError.badRequest("Bad request")
        case 404:
            if let errorBody = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.notFound(errorBody.message)
            }
            throw APIError.notFound("Not found")
        default:
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.serverError(httpResponse.statusCode, message)
        }
    }
}