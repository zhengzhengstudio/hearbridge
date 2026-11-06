package cn.zhengzhengstudio.survivaldiary

import cn.zhengzhengstudio.survivaldiary.domain.StorageRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StorageRulesTest {
    @Test fun crateTransfersArePersistentAndCannotExceedTwentyFourSlots() {
        val stored = StorageRules.deposit(
            inventory = mapOf("palm-fiber" to 9),
            storage = emptyMap(),
            itemId = "palm-fiber",
            requested = 6,
            stackLimit = 50,
        )
        assertTrue(stored.ok)
        assertEquals(3, stored.inventory["palm-fiber"])
        assertEquals(6, stored.storage["palm-fiber"])
        assertEquals(1, StorageRules.slotsUsed(stored.storage, mapOf("palm-fiber" to 50)))

        val taken = StorageRules.withdraw(stored.inventory, stored.storage, "palm-fiber", 2)
        assertTrue(taken.ok)
        assertEquals(5, taken.inventory["palm-fiber"])
        assertEquals(4, taken.storage["palm-fiber"])
    }
}
