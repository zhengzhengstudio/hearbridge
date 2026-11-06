//
//  ZhengZhengStudioApp.swift
//  ZhengZhengStudio
//
//  Created by LJG on 2026/1/26.
//

import SwiftUI

@main
struct ZhengZhengStudioApp: App {
    let persistenceController = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.managedObjectContext, persistenceController.container.viewContext)
        }
    }
}
