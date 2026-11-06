//
//  ZhengZhengStockApp.swift
//  ZhengZhengStock
//
//  Created by LJG on 2026/1/26.
//

import SwiftUI

@main
struct ZhengZhengStockApp: App {
    let persistenceController = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.managedObjectContext, persistenceController.container.viewContext)
        }
    }
}
