package cn.zhengzhengstudio.survivaldiary.domain

import kotlin.math.ceil

data class StorageTransfer(
    val ok: Boolean,
    val inventory: Map<String, Int>,
    val storage: Map<String, Int>,
    val moved: Int = 0,
    val reason: String? = null,
)

object StorageRules {
    const val MAX_SLOTS = 24

    fun slotsUsed(storage: Map<String, Int>, stackLimits: Map<String, Int>): Int = storage.entries.sumOf { (itemId, count) ->
        ceil(count.coerceAtLeast(0).toDouble() / (stackLimits[itemId] ?: 30).coerceAtLeast(1)).toInt()
    }

    fun deposit(
        inventory: Map<String, Int>, storage: Map<String, Int>, itemId: String, requested: Int,
        stackLimit: Int, capacity: Int = MAX_SLOTS, stackLimits: Map<String, Int> = emptyMap(),
    ): StorageTransfer {
        if (itemId.isBlank() || requested <= 0) return failed(inventory, storage, "转移数量无效")
        val carried = (inventory[itemId] ?: 0).coerceAtLeast(0)
        if (carried == 0) return failed(inventory, storage, "背包中没有该物品")
        val current = (storage[itemId] ?: 0).coerceAtLeast(0)
        val otherSlots = slotsUsed(storage - itemId, stackLimits)
        val room = ((capacity - otherSlots).coerceAtLeast(0) * stackLimit.coerceAtLeast(1) - current).coerceAtLeast(0)
        val moved = minOf(requested, carried, room)
        if (moved <= 0) return failed(inventory, storage, "储物箱已满")
        return StorageTransfer(
            true,
            inventory + (itemId to carried - moved),
            storage + (itemId to current + moved),
            moved,
        )
    }

    fun withdraw(inventory: Map<String, Int>, storage: Map<String, Int>, itemId: String, requested: Int): StorageTransfer {
        if (itemId.isBlank() || requested <= 0) return failed(inventory, storage, "转移数量无效")
        val stored = (storage[itemId] ?: 0).coerceAtLeast(0)
        if (stored == 0) return failed(inventory, storage, "箱子中没有该物品")
        val moved = minOf(requested, stored)
        val remaining = stored - moved
        val nextStorage = if (remaining == 0) storage - itemId else storage + (itemId to remaining)
        return StorageTransfer(true, inventory + (itemId to ((inventory[itemId] ?: 0) + moved)), nextStorage, moved)
    }

    private fun failed(inventory: Map<String, Int>, storage: Map<String, Int>, reason: String) =
        StorageTransfer(false, inventory, storage, reason = reason)
}
