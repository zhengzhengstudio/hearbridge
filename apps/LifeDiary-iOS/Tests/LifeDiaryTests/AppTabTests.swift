import XCTest
@testable import LifeDiaryCore

final class AppTabTests: XCTestCase {
    func testPrimaryTabsMatchApprovedInformationArchitecture() {
        XCTAssertEqual(AppTab.allCases.map(\.title), ["今天", "日记", "公共日记", "记账", "陪伴", "我的"])
    }

    func testCommunityDraftIsACopy() {
        let privateEntry = DiaryEntry.fixture(body: "private")
        let draft = CommunityDraft(copying: privateEntry)

        XCTAssertNotEqual(draft.id.uuidString, privateEntry.id.uuidString)
    }
}
