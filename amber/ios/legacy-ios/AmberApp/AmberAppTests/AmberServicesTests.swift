import XCTest
@testable import AmberApp

@MainActor
final class AmberServicesTests: XCTestCase {

    func testMockChatReturnsPayloadWithPeople() async throws {
        let service = MockChatService()
        let result = try await service.ask(question: "Who should I talk to about SF biotech?", topK: nil, filter: nil)
        XCTAssertFalse(result.answer.isEmpty)
        XCTAssertGreaterThan(result.people.count, 0)
        XCTAssertGreaterThan(result.citations.count, 0)
        XCTAssertTrue(result.usedPeopleRank)
    }

    func testMockChatSurfacesError() async {
        let service = MockChatService()
        service.injectedError = AmberServiceError.rateLimited
        do {
            _ = try await service.ask(question: "Hi", topK: nil, filter: nil)
            XCTFail("expected to throw")
        } catch let err as AmberServiceError {
            XCTAssertEqual(err, .rateLimited)
        } catch {
            XCTFail("unexpected: \(error)")
        }
    }

    func testContactRepositoryFiltersByCircle() async throws {
        #if DEBUG
        let repo = MockContactRepository()
        let inner = try await repo.fetch(circle: .inner, query: "")
        let all = try await repo.fetch(circle: .all, query: "")
        XCTAssertEqual(inner.count, AmberFixtures.innerCircle.count)
        XCTAssertGreaterThanOrEqual(all.count, inner.count)
        #endif
    }

    func testContactRepositoryFiltersByQuery() async throws {
        #if DEBUG
        let repo = MockContactRepository()
        let matches = try await repo.fetch(circle: .all, query: "Matthew")
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.name, "Matthew Kim")
        #endif
    }

    func testGraphWarmPathIncludesBridge() async throws {
        #if DEBUG
        let graph = MockGraphService()
        let path = try await graph.warmPath(to: AmberFixtures.matthewId)
        XCTAssertGreaterThanOrEqual(path.count, 1)
        XCTAssertEqual(path.last?.id, AmberFixtures.matthewId)
        #endif
    }

    func testAskPersonCodableRoundtrip() throws {
        let person = AmberAskPerson(id: "x", name: "Y", personId: "z", score: 0.9, pineconeScore: 0.8, reasoning: "r")
        let data = try JSONEncoder().encode(person)
        let back = try JSONDecoder().decode(AmberAskPerson.self, from: data)
        XCTAssertEqual(person, back)
    }

    func testLoadStateValueAccessor() {
        let idle: LoadState<Int> = .idle
        let loaded: LoadState<Int> = .loaded(42)
        XCTAssertNil(idle.value)
        XCTAssertEqual(loaded.value, 42)
        XCTAssertTrue(LoadState<Int>.loading.isLoading)
    }

    func testNotificationsUnreadCount() async throws {
        #if DEBUG
        let svc = MockNotificationsService()
        let count = try await svc.unreadCount()
        XCTAssertGreaterThanOrEqual(count, 1)
        let inbox = try await svc.inbox()
        XCTAssertEqual(inbox.count, AmberFixtures.notifications.count)
        #endif
    }
}
