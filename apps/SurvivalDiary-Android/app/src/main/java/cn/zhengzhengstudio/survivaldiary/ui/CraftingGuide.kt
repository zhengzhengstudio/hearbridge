package cn.zhengzhengstudio.survivaldiary.ui

data class CraftingRoute(val title: String, val steps: List<String>)

object CraftingGuide {
    private val routes = mapOf(
        "machete" to CraftingRoute(
            title = "青铜砍刀（升级）",
            steps = listOf(
                "制作石斧砍软木与硬木；制作石镐准备采矿",
                "用 4 软木原木、4 海蚀石、2 绳索制作并放置工作台",
                "收集 12 海蚀石、10 黏土、4 贝壳，在工作台制作并放置熔炉",
                "到石灰岩台地开采铜矿与锡矿，并准备至少 7 木炭",
                "熔炼 2 铜锭与 1 锡锭，再熔炼成 2 青铜锭",
                "带 2 青铜锭、1 硬木原木、1 绳索，在工作台制作砍刀",
            ),
        ),
        "stone-machete" to CraftingRoute(
            title = "石片砍刀（前期开荒）",
            steps = listOf(
                "捡取 2 块海蚀石和 1 根树枝",
                "用 4 棕榈纤维徒手搓出 1 根绳索",
                "徒手使用 2 海蚀石、1 树枝、1 绳索制作石片砍刀",
                "石片砍刀耐久 55；青铜砍刀耐久 180，是后续升级而非前置门槛",
            ),
        ),
    )

    fun routeFor(itemId: String): CraftingRoute = routes[itemId]
        ?: CraftingRoute(itemId, listOf("继续探索材料与制作设施以解锁这件物品"))
}
