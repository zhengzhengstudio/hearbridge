import SwiftUI
import SurvivalDiaryUI

@main
struct SurvivalDiaryMacApp: App {
    var body: some Scene {
        WindowGroup { GameContainerView().frame(minWidth: 760, minHeight: 520) }
    }
}
