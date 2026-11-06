package cn.zhengzhengstudio.survivaldiary.game

object GroundMaterialPolicy {
    private val tropicalBiomes = setOf("grassland", "palm-grove", "mangrove", "upland")
    private val coastalBiomes = setOf("beach", "rockland")

    fun materialFor(biome: String): String? = when (biome) {
        in tropicalBiomes -> "tropical-floor"
        in coastalBiomes -> "coastal-earth"
        else -> null
    }

    fun assetPath(material: String): String =
        "survival-v3/game/ground-material-v6/$material.webp"
}
