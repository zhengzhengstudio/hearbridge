package cn.zhengzhengstudio.survivaldiary.domain

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class CatalogEntry(val id: String, val name: String, val imageKey: String)
data class ItemAppearance(
    val id: String,
    val name: String,
    val category: String,
    val mass: Double,
    val stackLimit: Int,
    val use: String,
    val imageKey: String = "",
    val iconAssetPath: String = "",
)
data class BuildingAppearance(val id: String, val collisionWidth: Int, val collisionHeight: Int)
data class ResourceDefinition(
    val id: String,
    val itemId: String,
    val hardness: Int,
    val toolTags: List<String>,
    val yieldMin: Int,
    val yieldMax: Int,
    val recoveryMinutes: Int,
)
data class SpawnRule(val resourceId: String, val chance: Double)

class ContentCatalog(private val context: Context) {
    private val cache = mutableMapOf<String, List<CatalogEntry>>()

    fun items(): List<CatalogEntry> = load("items.json")
    fun resources(): List<CatalogEntry> = load("resources.json")
    fun buildings(): List<CatalogEntry> = load("buildings.json")
    fun recipes(): List<RecipeDefinition> {
        val text = context.assets.open("survival-v3/content/recipes.json").bufferedReader().use { it.readText() }
        val array = JSONArray(text)
        return (0 until array.length()).map { index ->
            val value = array.getJSONObject(index)
            val ingredientObject = value.getJSONObject("ingredients")
            val output = value.getJSONObject("output")
            val fuel = value.optJSONObject("fuel")
            RecipeDefinition(
                id = value.getString("id"),
                station = value.getString("station"),
                durationSeconds = value.getInt("durationSeconds"),
                ingredients = ingredientObject.keys().asSequence().associateWith(ingredientObject::getInt),
                outputItemId = output.getString("itemId"),
                outputAmount = output.getInt("amount"),
                fuelItemId = fuel?.getString("itemId"),
                fuelAmount = fuel?.getInt("amount") ?: 0,
            )
        }
    }
    fun itemAppearances(): Map<String, ItemAppearance> {
        val text = context.assets.open("survival-v3/content/items.json").bufferedReader().use { it.readText() }
        val array = JSONArray(text)
        val assets = runCatching {
            val manifest = context.assets.open("survival-v3/asset-manifest.json").bufferedReader().use { JSONObject(it.readText()) }
            manifest.optJSONObject("assets") ?: manifest
        }.getOrNull()
        return (0 until array.length()).associate { index ->
            val value = array.getJSONObject(index)
            val imageKey = value.optString("imageKey", "")
            val registeredPath = assets?.optJSONObject(imageKey)?.optJSONObject("variants")
                ?.optJSONObject("icon")?.optString("path", "").orEmpty()
            val packagedPath = registeredPath.substringAfter("assets/game/", "")
                .takeIf { it.isNotBlank() }?.let { "survival-v3/game/$it" }.orEmpty()
            val item = ItemAppearance(
                value.getString("id"), value.getString("name"), value.getString("category"),
                value.optDouble("mass", 0.0), value.optInt("stackLimit", 30), value.optString("use", ""),
                imageKey, packagedPath,
            )
            item.id to item
        }
    }

    fun buildingAppearances(): Map<String, BuildingAppearance> {
        val text = context.assets.open("survival-v3/content/buildings.json").bufferedReader().use { it.readText() }
        val array = JSONArray(text)
        return (0 until array.length()).associate { index ->
            val value = array.getJSONObject(index)
            val collision = value.getJSONObject("collision")
            val appearance = BuildingAppearance(value.getString("id"), collision.getInt("width"), collision.getInt("height"))
            appearance.id to appearance
        }
    }

    fun resourceDefinitions(): Map<String, ResourceDefinition> {
        val text = context.assets.open("survival-v3/content/resources.json").bufferedReader().use { it.readText() }
        val array = JSONArray(text)
        return (0 until array.length()).associate { index ->
            val value = array.getJSONObject(index)
            val yield = value.getJSONObject("yield")
            val tags = value.getJSONArray("toolTags")
            val definition = ResourceDefinition(
                id = value.getString("id"),
                itemId = value.getString("itemId"),
                hardness = value.getInt("hardness"),
                toolTags = (0 until tags.length()).map(tags::getString),
                yieldMin = yield.getInt("min"),
                yieldMax = yield.getInt("max"),
                recoveryMinutes = value.getInt("recoveryMinutes"),
            )
            definition.id to definition
        }
    }

    fun biomeSpawns(): Map<String, List<SpawnRule>> {
        val text = context.assets.open("survival-v3/content/biomes.json").bufferedReader().use { it.readText() }
        val array = JSONArray(text)
        return (0 until array.length()).associate { index ->
            val value = array.getJSONObject(index)
            val table = value.getJSONArray("spawnTable")
            value.getString("id") to (0 until table.length()).map { spawnIndex ->
                val spawn = table.getJSONObject(spawnIndex)
                SpawnRule(spawn.getString("resourceId"), spawn.getDouble("chance"))
            }
        }
    }

    private fun load(fileName: String): List<CatalogEntry> = cache.getOrPut(fileName) {
        val text = context.assets.open("survival-v3/content/$fileName").bufferedReader().use { it.readText() }
        val array = JSONArray(text)
        (0 until array.length()).map { index ->
            val value = array.getJSONObject(index)
            CatalogEntry(
                id = value.getString("id"),
                name = value.optString("name", value.optString("nameZh", value.getString("id"))),
                imageKey = value.optString("imageKey", ""),
            )
        }
    }
}
