package cn.zhengzhengstudio.survivaldiary.ui

import cn.zhengzhengstudio.survivaldiary.network.IslandChatMessage
import cn.zhengzhengstudio.survivaldiary.network.IslandConnectionStatus

data class OnlineIslandSummary(val id: String, val name: String, val memberCount: Int, val full: Boolean)

data class OnlineUiState(
    val status: IslandConnectionStatus = IslandConnectionStatus.LOCAL,
    val islandId: String = "",
    val revision: Long = 0,
    val publicIslands: List<OnlineIslandSummary> = emptyList(),
    val messages: List<IslandChatMessage> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)
