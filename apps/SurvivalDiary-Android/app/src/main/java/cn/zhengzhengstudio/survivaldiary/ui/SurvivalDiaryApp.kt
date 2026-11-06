package cn.zhengzhengstudio.survivaldiary.ui

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import cn.zhengzhengstudio.survivaldiary.BuildConfig
import cn.zhengzhengstudio.survivaldiary.data.SaveRepository
import cn.zhengzhengstudio.survivaldiary.domain.*
import cn.zhengzhengstudio.survivaldiary.game.NativeGameView
import cn.zhengzhengstudio.survivaldiary.game.ExplorationVisibility
import cn.zhengzhengstudio.survivaldiary.update.ReleaseUpdate
import cn.zhengzhengstudio.survivaldiary.update.DownloadProgress
import cn.zhengzhengstudio.survivaldiary.update.UpdateRepository
import cn.zhengzhengstudio.survivaldiary.network.SurvivalApi
import cn.zhengzhengstudio.survivaldiary.network.TokenVault
import cn.zhengzhengstudio.survivaldiary.network.IslandChatMessage
import cn.zhengzhengstudio.survivaldiary.network.IslandConnectionStatus
import cn.zhengzhengstudio.survivaldiary.network.IslandSocketClient
import cn.zhengzhengstudio.survivaldiary.network.IslandSocketListener
import org.json.JSONObject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.dropWhile
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class GamePanel { NONE, INVENTORY, CRAFTING, COMPENDIUM, NPC, STORAGE, FURNACE, FARM, HANDBOOK, MAP, DIARY, CHAT, SYSTEM }
data class PlacementDraft(val itemId: String, val coordinates: Coordinates, val rotation: Int = 0, val reason: String? = null)
object PlacementFlow { fun previewAt(draft: PlacementDraft, coordinates: Coordinates) = draft.copy(coordinates = coordinates) }
data class UnlockNotice(val title: String, val recipeLine: String, val key: Long = System.nanoTime())
data class NpcMerchantOffer(
    val id: String,
    val name: String,
    val rarity: String,
    val description: String,
    val giveName: String,
    val giveAmount: Int,
    val receiveName: String,
    val receiveAmount: Int,
)
data class NpcCompassHint(val targetId: String, val label: String, val coordinates: Coordinates, val reason: String)
data class NpcGameFeedback(val kind: String, val message: String)
data class NpcDialogueAnswer(
    val reply: String,
    val source: String,
    val merchantOffers: List<NpcMerchantOffer> = emptyList(),
    val merchantHeadline: String = "",
    val compassHint: NpcCompassHint? = null,
    val gameFeedback: NpcGameFeedback? = null,
)
data class NpcConversation(val npcId: String, val question: String, val reply: String, val source: String)
data class GameUiState(
    val save: GameSave,
    val contentReady: Boolean = false,
    val hasExistingSave: Boolean = false,
    val activePanel: GamePanel = GamePanel.NONE,
    val placement: PlacementDraft? = null,
    val notice: String? = null,
    val selectedHotbar: Int = 0,
    val hotbarSlots: List<String?> = List(HotbarRules.SLOT_COUNT) { null },
    val nearbyResource: ResourceNodeState? = null,
    val nearbyEntity: Entity? = null,
    val nearbyGroundItem: GroundItem? = null,
    val currentBiome: String = "palm-grove",
    val recipes: List<RecipeDefinition> = emptyList(),
    val itemNames: Map<String, String> = emptyMap(),
    val items: Map<String, ItemAppearance> = emptyMap(),
    val buildingAppearances: Map<String, BuildingAppearance> = emptyMap(),
    val resourceDefinitions: Map<String, ResourceDefinition> = emptyMap(),
    val biomeSpawns: Map<String, List<SpawnRule>> = emptyMap(),
    val gatherableItemIds: Set<String> = emptySet(),
    val highlightedRecipeIds: Set<String> = emptySet(),
    val unlockNotice: UnlockNotice? = null,
    val activeStorageId: String? = null,
    val activeFurnaceId: String? = null,
    val activeFarmId: String? = null,
    val activeCraftStation: String = "hand",
    val online: OnlineUiState = OnlineUiState(),
    val aiCompassHint: NpcCompassHint? = null,
)

class GameViewModel(application: Application = Application()) : AndroidViewModel(application) {
    private val repository = SaveRepository(application)
    private val catalog by lazy { ContentCatalog(application) }
    @Volatile private var itemCatalog: Map<String, ItemAppearance> = emptyMap()
    @Volatile private var itemMasses: Map<String, Double> = emptyMap()
    @Volatile private var itemStackLimits: Map<String, Int> = emptyMap()
    @Volatile private var buildingAppearances: Map<String, BuildingAppearance> = emptyMap()
    private val survivalApi = SurvivalApi()
    private val tokenVault = TokenVault(application)
    private val npcMemories = mutableMapOf<String, String>()
    private val npcConversationMemory = mutableMapOf<String, NpcConversation>()
    private val mutableState = MutableStateFlow(GameUiState(
        // A tiny in-memory state lets Compose draw the launcher before disk and
        // JSON catalog work begins. Gameplay controls stay disabled until ready.
        save = SurvivalSimulation.create("loading"),
    ))
    val state: StateFlow<GameUiState> = mutableState.asStateFlow()

    fun npcConversation(npcId: String?): NpcConversation? = npcId?.let(npcConversationMemory::get)

    fun rememberNpcConversation(conversation: NpcConversation) {
        npcConversationMemory[conversation.npcId] = conversation
    }
    private var currentActivity = SurvivalActivity.IDLE
    private var islandSessionToken = ""
    private val islandSocket by lazy {
        IslandSocketClient(listener = object : IslandSocketListener {
            override fun onStatus(status: IslandConnectionStatus, message: String?) {
                val current = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = current.copy(status = status, loading = false, error = message))
            }
            override fun onSnapshot(islandId: String, revision: Long, world: JSONObject) {
                val current = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = current.copy(status = IslandConnectionStatus.ONLINE, islandId = islandId, revision = revision, loading = false, error = null))
            }
            override fun onChat(message: IslandChatMessage) {
                val current = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = current.copy(messages = (current.messages + message).takeLast(80)))
            }
        })
    }

    private fun ensureFarmStarter(save: GameSave): GameSave = if (save.milestones["nativeFarmBootstrapVersion:1"] == true) save else save.copy(
        inventory = save.inventory + ("taro-seed" to ((save.inventory["taro-seed"] ?: 0) + 1)),
        milestones = save.milestones + ("nativeFarmBootstrapVersion:1" to true),
    )

    init {
        viewModelScope.launch(Dispatchers.IO) {
            val loadedItems = runCatching(catalog::itemAppearances).getOrDefault(emptyMap())
            val loadedMasses = loadedItems.mapValues { it.value.mass }
            val loadedStackLimits = loadedItems.mapValues { it.value.stackLimit }
            val loadedBuildings = runCatching(catalog::buildingAppearances).getOrDefault(emptyMap())
            val loadedResources = runCatching(catalog::resourceDefinitions).getOrDefault(emptyMap())
            val loadedSpawns = runCatching(catalog::biomeSpawns).getOrDefault(emptyMap())
            val restoredSave = runCatching { repository.load(SAVE_SLOT) }.getOrNull()
            val initialSave = withCarriedMass(
                TransportRules.ensureStarter(ensureFarmStarter(NativeNpcRules.ensureStarter(SaveLifecycle.initial(restoredSave) {
                    SurvivalSimulation.create("local-${System.currentTimeMillis()}")
                }))),
                loadedMasses,
            )
            itemCatalog = loadedItems
            itemMasses = loadedMasses
            itemStackLimits = loadedStackLimits
            buildingAppearances = loadedBuildings
            mutableState.value = GameUiState(
                save = initialSave,
                contentReady = true,
                hasExistingSave = restoredSave != null,
                hotbarSlots = HotbarRules.initial(initialSave.inventory),
                recipes = runCatching(catalog::recipes).getOrDefault(emptyList()),
                itemNames = loadedItems.mapValues { it.value.name },
                items = loadedItems,
                buildingAppearances = loadedBuildings,
                resourceDefinitions = loadedResources,
                biomeSpawns = loadedSpawns,
                gatherableItemIds = loadedResources.values.map { it.itemId }.toSet(),
            )
        }
        viewModelScope.launch(Dispatchers.IO) {
            state.dropWhile { !it.contentReady }.map { it.save }.distinctUntilChanged().drop(1).conflate().collect { save ->
                runCatching { repository.save(SAVE_SLOT, save) }
                delay(2_000)
            }
        }
    }

    private fun ensureIslandSession(): String {
        if (islandSessionToken.isNotBlank()) return islandSessionToken
        islandSessionToken = tokenVault.read() ?: survivalApi.createGuestSession(tokenVault.deviceId()).also(tokenVault::write)
        return islandSessionToken
    }

    fun refreshPublicIslands() {
        mutableState.value = mutableState.value.copy(online = mutableState.value.online.copy(loading = true, error = null))
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { survivalApi.listPublicIslands() }.onSuccess { array ->
                val islands = buildList {
                    for (index in 0 until array.length()) {
                        val item = array.optJSONObject(index) ?: continue
                        val members = item.optJSONArray("members")?.length() ?: item.optInt("memberCount", 0)
                        add(OnlineIslandSummary(item.optString("id"), item.optString("name", item.optString("id")), members, members >= 4))
                    }
                }
                val online = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = online.copy(publicIslands = islands, loading = false))
            }.onFailure { error ->
                val online = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = online.copy(loading = false, error = error.message ?: "公共岛读取失败"))
            }
        }
    }

    fun createPublicIsland() {
        mutableState.value = mutableState.value.copy(online = mutableState.value.online.copy(loading = true, error = null))
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val token = ensureIslandSession()
                val result = survivalApi.ensurePublicIsland(token, mutableState.value.save.seed)
                val island = result.optJSONObject("island") ?: result
                island.optString("id").takeIf(String::isNotBlank) ?: error("服务器没有返回公共岛")
            }.onSuccess(::joinPublicIsland).onFailure { error ->
                val online = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = online.copy(loading = false, error = error.message ?: "公共岛创建失败"))
            }
        }
    }

    fun joinPublicIsland(islandId: String) {
        if (islandId.isBlank()) return
        mutableState.value = mutableState.value.copy(activePanel = GamePanel.CHAT, online = mutableState.value.online.copy(status = IslandConnectionStatus.CONNECTING, islandId = islandId, loading = true, error = null))
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val token = ensureIslandSession()
                survivalApi.visitIsland(token, islandId)
                islandSocket.join(token, islandId)
            }.onFailure { error ->
                val online = mutableState.value.online
                mutableState.value = mutableState.value.copy(online = online.copy(status = IslandConnectionStatus.OFFLINE, loading = false, error = error.message ?: "加入公共岛失败"))
            }
        }
    }

    fun sendIslandChat(text: String) = runCatching { islandSocket.sendChat(text) }.onFailure { error ->
        mutableState.value = mutableState.value.copy(online = mutableState.value.online.copy(error = error.message))
    }

    fun leaveOnline() {
        islandSocket.leave()
        mutableState.value = mutableState.value.copy(online = OnlineUiState(publicIslands = mutableState.value.online.publicIslands))
    }

    override fun onCleared() {
        islandSocket.close()
        super.onCleared()
    }

    fun restartWorld() {
        runCatching { repository.reset(SAVE_SLOT) }
        val fresh = withCarriedMass(TransportRules.ensureStarter(ensureFarmStarter(NativeNpcRules.ensureStarter(SurvivalSimulation.create("local-${System.currentTimeMillis()}")))), itemMasses)
        mutableState.value = GameUiState(
            save = fresh,
            contentReady = true,
            hasExistingSave = true,
            hotbarSlots = HotbarRules.initial(fresh.inventory),
            recipes = mutableState.value.recipes,
            itemNames = mutableState.value.itemNames,
            items = mutableState.value.items,
            buildingAppearances = mutableState.value.buildingAppearances,
            resourceDefinitions = mutableState.value.resourceDefinitions,
            biomeSpawns = mutableState.value.biomeSpawns,
            gatherableItemIds = mutableState.value.gatherableItemIds,
            notice = "新世界已经建立",
        )
    }

    fun advanceClock(elapsedRealMs: Long = 1_000) {
        val before = mutableState.value.save
        val advanced = SurvivalSimulation.advance(before, elapsedRealMs, currentActivity)
        val elapsed = (advanced.elapsedGameMinutes - before.elapsedGameMinutes).coerceAtLeast(0.0)
        val residentAdvanced = NativeNpcRules.advanceResidents(NativeFarmRules.advance(FurnaceRules.advance(advanced, elapsed), elapsed))
        val player = residentAdvanced.players["local"]?.position
        val wildlife = WildlifeEngine.step(
            ensureWildlifePopulations(residentAdvanced),
            WildlifeContext(player = player?.let { WildlifePlayer("local", WildlifePosition(it.x, it.y)) }),
            elapsed,
        )
        mutableState.value = mutableState.value.copy(save = residentAdvanced.copy(wildlife = wildlife))
    }

    private fun ensureWildlifePopulations(save: GameSave): WildlifeState {
        if (save.wildlife.populations.isNotEmpty()) return save.wildlife
        val populations = linkedMapOf<String, PopulationState>()
        save.discoveredChunks.keys.ifEmpty { setOf("0,0") }.sorted().forEach { chunk ->
            val parts = chunk.split(','); val x = parts.getOrNull(0)?.toIntOrNull() ?: 0; val y = parts.getOrNull(1)?.toIntOrNull() ?: 0
            val biome = WorldGenerator.sample(save.seed, x * 16.0 + 8, y * 16.0 + 8).biome
            val species = when (biome) {
                "lagoon" -> "sea-turtle"; "mangrove" -> "land-crab"; "cloud-forest" -> "wild-boar"
                "basalt-ridge", "limestone-upland" -> "mountain-goat"; "dry-savanna" -> "wild-rabbit"; else -> "seabird"
            }
            populations["$chunk:$species"] = PopulationState(2, 1, 7, 0.0, save.wildlife.elapsedMinutes)
        }
        return save.wildlife.copy(populations = populations)
    }

    fun setPlayerMoving(moving: Boolean) {
        currentActivity = if (moving) SurvivalActivity.WALKING else SurvivalActivity.IDLE
        if (moving && mutableState.value.save.milestones["tutorial:moved"] != true) {
            val save = mutableState.value.save
            mutableState.value = mutableState.value.copy(
                save = save.copy(milestones = save.milestones + ("tutorial:moved" to true)),
            )
        }
    }

    fun persistNow() {
        if (mutableState.value.contentReady) runCatching { repository.save(SAVE_SLOT, mutableState.value.save) }
    }

    fun setPlayMode(mode: PlayMode) = mutate(GameCommand.SetPlayMode(mode))
    fun craft(recipeId: String) = runCatching {
        val recipe = mutableState.value.recipes.first { it.id == recipeId }
        require(recipe.station != "furnace") { "请靠近熔炉，在设施面板中投入矿料和燃料" }
        val stations = setOf("hand", mutableState.value.activeCraftStation)
        val knownItems = knownItems()
        require(RecipeUnlockPolicy.isUnlocked(recipe, knownItems, stations)) { "这份配方尚未解锁" }
        val crafted = CraftingEngine.craft(mutableState.value.save, recipe, stations)
        require(InventoryRules.mass(crafted.inventory, itemMasses) <= InventoryRules.capacity(crafted.inventory)) { "背包放不下制作结果" }
        val beforeItems = knownItems
        val afterItems = beforeItems + recipe.outputItemId
        val newlyVisible = RecipeUnlockPolicy.newlyVisibleRecipes(
            mutableState.value.recipes, beforeItems, afterItems, stations, stations,
        ).filter { it.station != "furnace" }
        mutableState.value = mutableState.value.copy(
            save = withCarriedMass(crafted.copy(milestones = crafted.milestones + ("item:${recipe.outputItemId}" to true) + ("recipe:${recipe.id}" to true)), itemMasses),
            notice = "已制作 ${mutableState.value.itemNames[recipe.outputItemId] ?: recipe.outputItemId}",
            highlightedRecipeIds = newlyVisible.mapTo(mutableSetOf()) { it.id },
            unlockNotice = unlockNotice(recipe.outputItemId, newlyVisible),
        )
    }.onFailure { notice(it.message ?: "材料不足") }
    fun beginPlacement(itemId: String) {
        val save = mutableState.value.save
        val reason = if ((save.inventory[itemId] ?: 0) < 1) "背包里没有可放置的物品" else null
        val player = save.players["local"]?.position
        val nearby = Coordinates(
            kotlin.math.round(player?.x ?: 8.0).toInt() + 1,
            kotlin.math.round(player?.y ?: 8.0).toInt(),
        )
        mutableState.value = mutableState.value.copy(placement = PlacementDraft(itemId, nearby, reason = reason))
        if (reason == null) placeAt(nearby)
    }
    fun rotatePlacement() { mutableState.value.placement?.let { mutableState.value = mutableState.value.copy(placement = it.copy(rotation = (it.rotation + 90) % 360)) } }
    fun confirmPlacement() {
        val draft = mutableState.value.placement ?: return
        if (draft.reason != null) return
        val beforeStations = availableStations()
        mutate(GameCommand.Place("${draft.itemId}-${System.currentTimeMillis()}", draft.itemId, draft.coordinates, draft.rotation))
        val afterStations = availableStations()
        val known = knownItems()
        val stationRecipes = RecipeUnlockPolicy.newlyVisibleRecipes(
            mutableState.value.recipes, known, known, beforeStations, afterStations,
        ).filter { it.station == draft.itemId }
        mutableState.value = mutableState.value.copy(
            placement = null,
            highlightedRecipeIds = emptySet(),
            unlockNotice = if (stationRecipes.isEmpty()) null else UnlockNotice(
                "解锁了 ${mutableState.value.itemNames[draft.itemId] ?: draft.itemId}",
                "可制作：${stationRecipes.take(3).joinToString("、") { mutableState.value.itemNames[it.outputItemId] ?: it.outputItemId }}",
            ),
        )
    }
    fun placeAt(coordinates: Coordinates) {
        val draft = mutableState.value.placement ?: return
        fun size(type: String, rotation: Int = 0): Pair<Double, Double> {
            val appearance = buildingAppearances[type]
            val width = (appearance?.collisionWidth ?: 1).toDouble()
            val height = (appearance?.collisionHeight ?: 1).toDouble()
            return if (rotation % 180 == 0) width to height else height to width
        }
        val (draftWidth, draftHeight) = size(draft.itemId, draft.rotation)
        val occupied = mutableState.value.save.entities.values.any { entity ->
            if (draft.itemId != "road-segment" && entity.type == "road-segment") return@any false
            val (otherWidth, otherHeight) = size(entity.type, entity.rotation)
            kotlin.math.abs(entity.coordinates.x - coordinates.x) < (draftWidth + otherWidth) / 2.0 &&
                kotlin.math.abs(entity.coordinates.y - coordinates.y) < (draftHeight + otherHeight) / 2.0
        }
        val coversRoad = draft.itemId != "road-segment" && mutableState.value.save.entities.values.any { entity ->
            entity.type == "road-segment" &&
                kotlin.math.abs(entity.coordinates.x - coordinates.x) < (draftWidth + 1.0) / 2.0 &&
                kotlin.math.abs(entity.coordinates.y - coordinates.y) < (draftHeight + 1.0) / 2.0
        }
        val biome = WorldGenerator.sample(mutableState.value.save.seed, coordinates.x.toDouble(), coordinates.y.toDouble()).biome
        val waterAllowed = draft.itemId in setOf("dock", "rope-bridge")
        val discovered = ExplorationVisibility.contains(coordinates, mutableState.value.save.discoveredChunks.keys)
        val reason = when {
            !discovered -> "先探索这片区域再建造"
            occupied -> "这里已有建筑"
            coversRoad -> "建筑会堵住道路，请放在路边"
            biome == "lagoon" && !waterAllowed -> "普通建筑不能放在水面"
            biome != "lagoon" && draft.itemId == "dock" -> "码头需要连接水岸"
            else -> null
        }
        mutableState.value = mutableState.value.copy(placement = PlacementFlow.previewAt(draft, coordinates).copy(reason = reason))
    }
    fun cancelPlacement() { mutableState.value = mutableState.value.copy(placement = null) }
    fun writeDiary(text: String) { mutate(GameCommand.WriteDiary("day-${mutableState.value.save.day}", text)); closePanel() }
    fun openPanel(panel: GamePanel) { mutableState.value = mutableState.value.copy(activePanel = panel) }
    fun closePanel() { mutableState.value = mutableState.value.copy(activePanel = GamePanel.NONE, activeStorageId = null, activeFurnaceId = null, activeFarmId = null) }
    fun clearUnlockNotice(key: Long) {
        if (mutableState.value.unlockNotice?.key == key) mutableState.value = mutableState.value.copy(unlockNotice = null)
    }
    fun clearNotice(expected: String) {
        if (mutableState.value.notice == expected) mutableState.value = mutableState.value.copy(notice = null)
    }
    fun reportMovementBlocked() = notice("前方是深水或地形边界，请沿岸绕行；码头和绳桥可以通行")
    fun openNearbyStorage() {
        val crate = mutableState.value.nearbyEntity?.takeIf { it.type == "storage-crate" }
            ?: return notice("靠近储物箱后再打开")
        mutableState.value = mutableState.value.copy(activePanel = GamePanel.STORAGE, activeStorageId = crate.id)
    }
    fun depositToStorage(itemId: String, amount: Int) = transferStorage(itemId, amount, deposit = true)
    fun withdrawFromStorage(itemId: String, amount: Int) = transferStorage(itemId, amount, deposit = false)
    private fun transferStorage(itemId: String, amount: Int, deposit: Boolean) {
        val ui = mutableState.value
        val containerId = ui.activeStorageId ?: return notice("储物箱未打开")
        val stored = ui.save.containerInventories[containerId].orEmpty()
        val result = if (deposit) StorageRules.deposit(ui.save.inventory, stored, itemId, amount, itemStackLimits[itemId] ?: 30, stackLimits = itemStackLimits)
            else StorageRules.withdraw(ui.save.inventory, stored, itemId, amount)
        if (!result.ok) return notice(result.reason ?: "无法转移物品")
        val save = withCarriedMass(ui.save.copy(
            inventory = result.inventory,
            containerInventories = ui.save.containerInventories + (containerId to result.storage),
        ), itemMasses)
        mutableState.value = ui.copy(save = save, notice = if (deposit) "已存入 ${result.moved}" else "已取回 ${result.moved}")
    }
    fun openNearbyFurnace() {
        val furnace = mutableState.value.nearbyEntity?.takeIf { it.type == "furnace" }
            ?: return notice("靠近熔炉后再操作")
        mutableState.value = mutableState.value.copy(activePanel = GamePanel.FURNACE, activeFurnaceId = furnace.id)
    }
    fun startFurnace(recipeId: String) {
        val ui = mutableState.value
        val furnaceId = ui.activeFurnaceId ?: return notice("熔炉未打开")
        val recipe = ui.recipes.firstOrNull { it.id == recipeId && it.station == "furnace" }
            ?: return notice("未知熔炼配方")
        val result = FurnaceRules.start(ui.save, furnaceId, recipe)
        mutableState.value = ui.copy(
            save = if (result.ok) withCarriedMass(result.save, itemMasses) else ui.save,
            notice = if (result.ok) "已点燃熔炉，队列随岛屿时间推进" else result.reason,
        )
    }
    fun claimFurnace() {
        val ui = mutableState.value
        val furnaceId = ui.activeFurnaceId ?: return notice("熔炉未打开")
        val result = FurnaceRules.claim(ui.save, furnaceId)
        mutableState.value = ui.copy(
            save = if (result.ok) withCarriedMass(result.save, itemMasses) else ui.save,
            notice = if (result.ok) "熔炼产物已放入背包" else result.reason,
        )
    }
    fun openNearbyFarm() {
        val farm = mutableState.value.nearbyEntity?.takeIf { it.type in setOf("farm-plot", "garden-plot") }
            ?: return notice("靠近农田后再操作")
        mutableState.value = mutableState.value.copy(save = NativeFarmRules.ensurePlot(mutableState.value.save, farm.id), activePanel = GamePanel.FARM, activeFarmId = farm.id)
    }
    fun plantCrop(slot: Int, seedId: String) = runCatching {
        val id = mutableState.value.activeFarmId ?: error("没有选中农田")
        mutableState.value = mutableState.value.copy(save = withCarriedMass(NativeFarmRules.plant(mutableState.value.save, id, slot, seedId), itemMasses), notice = "种子已经播下")
    }.onFailure { notice(it.message ?: "无法播种") }
    fun waterCrop() = runCatching {
        val id = mutableState.value.activeFarmId ?: error("没有选中农田")
        mutableState.value = mutableState.value.copy(save = withCarriedMass(NativeFarmRules.water(mutableState.value.save, id), itemMasses), notice = "农田已经浇水")
    }.onFailure { notice(it.message ?: "无法浇水") }
    fun harvestCrop(slot: Int) = runCatching {
        val id = mutableState.value.activeFarmId ?: error("没有选中农田")
        mutableState.value = mutableState.value.copy(save = withCarriedMass(NativeFarmRules.harvest(mutableState.value.save, id, slot), itemMasses), notice = "收获完成")
    }.onFailure { notice(it.message ?: "无法收获") }
    fun selectHotbar(index: Int) { mutableState.value = mutableState.value.copy(selectedHotbar = index.coerceIn(0, HotbarRules.SLOT_COUNT - 1)) }
    fun equipHotbar(itemId: String, slot: Int = mutableState.value.selectedHotbar) = runCatching {
        mutableState.value = mutableState.value.copy(
            hotbarSlots = HotbarRules.assign(mutableState.value.hotbarSlots, slot, itemId, mutableState.value.save.inventory),
            selectedHotbar = slot,
            notice = "已放入快捷栏 ${slot + 1}",
        )
    }.onFailure { notice(it.message ?: "无法装备") }
    fun clearHotbar(slot: Int) { mutableState.value = mutableState.value.copy(hotbarSlots = HotbarRules.remove(mutableState.value.hotbarSlots, slot), notice = "已从快捷栏移除") }
    fun gather(itemId: String) = mutate(GameCommand.Gather(itemId, 1))
    fun setNearbyResource(node: ResourceNodeState?) {
        if (mutableState.value.nearbyResource?.id != node?.id) mutableState.value = mutableState.value.copy(nearbyResource = node)
    }
    fun setNearbyEntity(entity: Entity?) {
        val current = mutableState.value
        val startsOpeningScene = entity?.id == NativeNpcRules.BUILDER_ID &&
            current.save.milestones["tutorial:moved"] == true &&
            NativeNpcRules.needsFirstEncounter(current.save) &&
            current.activePanel == GamePanel.NONE
        if (startsOpeningScene) {
            entity?.let(::openNpc)
        } else if (current.nearbyEntity?.id != entity?.id) {
            mutableState.value = current.copy(nearbyEntity = entity)
        }
    }
    fun setNearbyGroundItem(item: GroundItem?) {
        if (mutableState.value.nearbyGroundItem?.id != item?.id) mutableState.value = mutableState.value.copy(nearbyGroundItem = item)
    }
    fun openNpc(entity: Entity) {
        if (!NativeNpcRules.isVillager(entity.type)) return
        val current = mutableState.value
        val firstEncounter = entity.id == NativeNpcRules.BUILDER_ID && NativeNpcRules.needsFirstEncounter(current.save)
        val save = if (firstEncounter) NativeNpcRules.beginFirstEncounter(current.save) else current.save
        if (firstEncounter) {
            npcConversationMemory[entity.id] = NpcConversation(
                npcId = entity.id,
                question = "",
                reply = NativeNpcRules.firstEncounterDialogue(),
                source = "第一章 · 残骸海湾",
            )
        }
        mutableState.value = current.copy(
            save = save,
            nearbyEntity = save.entities[entity.id] ?: entity,
            activePanel = GamePanel.NPC,
        )
    }
    fun recruitNpc() = runCatching {
        val foodIds = mutableState.value.items.values.filter { it.category == "food" }.mapTo(mutableSetOf()) { it.id }
        val save = NativeNpcRules.recruit(mutableState.value.save, foodIds)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(save, itemMasses), notice = "阿拓加入了营地")
    }.onFailure { notice(it.message ?: "暂时无法招募") }
    fun npcHaul() = runCatching {
        val save = NativeNpcRules.haul(mutableState.value.save, itemMasses)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(save, itemMasses), notice = "阿拓把 4 份材料搬进了储物箱")
    }.onFailure { notice(it.message ?: "无法搬运") }
    fun npcRepair() = runCatching {
        val save = NativeNpcRules.repair(mutableState.value.save)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(save, itemMasses), notice = "阿拓修好了受损设施")
    }.onFailure { notice(it.message ?: "无法修理") }
    fun npcTrade(offerId: String) = runCatching {
        val npc = mutableState.value.nearbyEntity ?: error("没有选中居民")
        val save = NativeNpcRules.trade(mutableState.value.save, npc.type, offerId)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(save, itemMasses), notice = "交易完成")
    }.onFailure { notice(it.message ?: "无法交易") }
    suspend fun talkToNpc(question: String): NpcDialogueAnswer = withContext(Dispatchers.IO) {
        val snapshot = mutableState.value
        val npc = snapshot.nearbyEntity?.takeIf { NativeNpcRules.isVillager(it.type) }
            ?: return@withContext NpcDialogueAnswer("先靠近一位幸存者。", "离线回应")
        val local = NativeNpcRules.localDialogue(npc, question, NativeNpcRules.isRecruited(snapshot.save))
        val player = snapshot.save.players["local"]?.position ?: PlayerPosition(8.0, 8.0)
        fun directionTo(coordinates: Coordinates): String {
            val dx = coordinates.x - player.x
            val dy = coordinates.y - player.y
            val horizontal = if (kotlin.math.abs(dx) < 1.5) "" else if (dx > 0) "东" else "西"
            val vertical = if (kotlin.math.abs(dy) < 1.5) "" else if (dy > 0) "南" else "北"
            return (vertical + horizontal).ifBlank { "附近" }
        }
        fun targetName(entity: Entity): String = when {
            NativeNpcRules.isVillager(entity.type) -> NativeNpcRules.name(entity)
            entity.type == "rowboat" -> "岸边木船"
            entity.type == "minecart" -> "轨道矿车"
            entity.type == "storage-crate" -> "储物箱"
            entity.type == "workbench" -> "工作台"
            entity.type in ShelterRules.usableTypes -> "休息处"
            else -> entity.type
        }
        val navigationTargets = ExplorationVisibility.entities(snapshot.save.entities.values, snapshot.save.discoveredChunks.keys)
            .filter { it.type in setOf("rowboat", "minecart", "storage-crate", "workbench", "furnace", "farm-plot", "garden-plot") || NativeNpcRules.isVillager(it.type) || it.type in ShelterRules.usableTypes }
            .distinctBy(Entity::id).sortedBy { kotlin.math.hypot(it.coordinates.x - player.x, it.coordinates.y - player.y) }.take(16)
        val navigationById = navigationTargets.associateBy(Entity::id)
        val payload = JSONObject()
            .put("villagerId", npc.id)
            .put("villagerName", NativeNpcRules.name(npc))
            .put("role", NativeNpcRules.role(npc))
            .put("relationship", when {
                npc.type == NativeNpcRules.WANDERER_TYPE -> "independent"
                NativeNpcRules.isRecruited(snapshot.save) -> "joined"
                else -> "not-recruited"
            })
            .put("question", question.take(240))
            .put("biome", snapshot.currentBiome)
            .put("inventory", snapshot.save.inventory.filterValues { it > 0 }.entries.take(16).map { "${snapshot.itemNames[it.key] ?: it.key}×${it.value}" })
            .put("inventoryItems", org.json.JSONArray(snapshot.save.inventory.filterValues { it > 0 }.entries.take(32).map {
                JSONObject().put("id", it.key).put("name", snapshot.itemNames[it.key] ?: it.key).put("amount", it.value)
            }))
            .put("discoveredRegions", org.json.JSONArray(snapshot.save.discoveredChunks.keys.take(24)))
            .put("nearby", org.json.JSONArray(listOfNotNull(
                snapshot.nearbyResource?.displayName,
                snapshot.nearbyGroundItem?.let { snapshot.itemNames[it.itemId] ?: it.itemId },
                snapshot.nearbyEntity?.let(::targetName),
            )))
            .put("navigationTargets", org.json.JSONArray(navigationTargets.map { target ->
                JSONObject().put("id", target.id).put("name", targetName(target))
                    .put("direction", directionTo(target.coordinates))
                    .put("distance", kotlin.math.hypot(target.coordinates.x - player.x, target.coordinates.y - player.y).toInt().coerceAtLeast(1))
            }))
            .put("memory", npcMemories[npc.id].orEmpty())
        if (npc.type == NativeNpcRules.TRADER_TYPE) payload.put("merchantStockCandidates", org.json.JSONArray(listOf(
            JSONObject().put("id", "stone-for-millet").put("name", "海岸粟种匣").put("description", "适合开出第一块粟田").put("rarity", "村落精选").put("give", "stone").put("giveAmount", 3).put("receive", "millet-seed").put("receiveAmount", 2),
            JSONObject().put("id", "iron-for-repair").put("name", "旧船维修包").put("description", "行商从沉船零件里整理出的工具包").put("rarity", "漂泊珍货").put("give", "iron-ore").put("giveAmount", 1).put("receive", "repair-kit").put("receiveAmount", 1),
            JSONObject().put("id", "tokens-for-rope").put("name", "风暴绳结").put("description", "雨季前才会带上岛的双股绳索").put("rarity", "今日限定").put("give", "shell-token").put("giveAmount", 3).put("receive", "rope").put("receiveAmount", 1),
        )))
        fun freshSession(): String = survivalApi.createGuestSession(tokenVault.deviceId()).also(tokenVault::write)
        val firstToken = tokenVault.read() ?: runCatching(::freshSession).getOrNull()
            ?: return@withContext NpcDialogueAnswer(local, "网络不可用 · 离线回答")
        val response = runCatching { survivalApi.talkToVillager(firstToken, payload) }
            .recoverCatching { error ->
                if (error is cn.zhengzhengstudio.survivaldiary.network.SurvivalApiException && error.statusCode == 401) {
                    survivalApi.talkToVillager(freshSession(), payload)
                } else throw error
            }
            .getOrNull()
            ?: return@withContext NpcDialogueAnswer(local, "服务器连接失败 · 离线回答")
        val reply = response.optString("reply").trim().ifEmpty { local }
        response.optString("memory").takeIf(String::isNotBlank)?.let { npcMemories[npc.id] = it }
        val source = if (response.optString("source") == "kimi") {
            "Kimi 在线回应"
        } else {
            when (response.optString("reason")) {
                "not_configured" -> "Kimi 未配置 · 离线回答"
                "authentication" -> "Kimi 密钥无效 · 离线回答"
                "configuration" -> "Kimi 地址或模型配置有误 · 离线回答"
                "subscription" -> "Kimi 会员权益不可用 · 离线回答"
                "rate_limited" -> "Kimi 限流 · 离线回答"
                "timeout" -> "Kimi 响应超时 · 离线回答"
                else -> "Kimi 暂时不可用 · 离线回答"
            }
        }
        val catalog = response.optJSONObject("merchantCatalog")
        val offersJson = catalog?.optJSONArray("offers")
        val offers = buildList {
            if (offersJson != null) for (index in 0 until offersJson.length()) {
                val offer = offersJson.optJSONObject(index) ?: continue
                val id = offer.optString("id")
                if (id !in setOf("stone-for-millet", "iron-for-repair", "tokens-for-rope")) continue
                add(NpcMerchantOffer(
                    id = id,
                    name = offer.optString("name", id),
                    rarity = offer.optString("rarity"),
                    description = offer.optString("description"),
                    giveName = snapshot.itemNames[offer.optString("give")] ?: offer.optString("give"),
                    giveAmount = offer.optInt("giveAmount", 1),
                    receiveName = snapshot.itemNames[offer.optString("receive")] ?: offer.optString("receive"),
                    receiveAmount = offer.optInt("receiveAmount", 1),
                ))
            }
        }
        val compassJson = response.optJSONObject("compassHint")
        val compassHint = compassJson?.optString("targetId")?.let(navigationById::get)?.let { target ->
            NpcCompassHint(
                target.id,
                compassJson.optString("label", targetName(target)),
                target.coordinates,
                compassJson.optString("reason", "朝${directionTo(target.coordinates)}寻找${targetName(target)}"),
            )
        }
        val feedbackJson = response.optJSONObject("gameFeedback")
        val gameFeedback = feedbackJson?.optString("message")?.takeIf(String::isNotBlank)?.let {
            NpcGameFeedback(feedbackJson.optString("kind", "exploration"), it.take(100))
        }
        if (compassHint != null) withContext(Dispatchers.Main) {
            mutableState.value = mutableState.value.copy(aiCompassHint = compassHint, notice = "指南针已标记 · ${compassHint.label}")
        }
        NpcDialogueAnswer(reply, source, offers, catalog?.optString("headline").orEmpty(), compassHint, gameFeedback)
    }
    fun setCurrentBiome(biome: String) {
        if (mutableState.value.currentBiome != biome) mutableState.value = mutableState.value.copy(currentBiome = biome)
    }
    fun harvestNearby() {
        val node = mutableState.value.nearbyResource ?: return notice("靠近可采集资源后再尝试")
        val save = mutableState.value.save
        val tools = save.inventory.filterValues { it > 0 }.keys
        if (!ToolCompatibility.canHarvest(node.toolTags, tools)) return notice("需要 ${ToolCompatibility.requiredLabel(node.toolTags)}，当前工具不适用")
        val selectedTool = mutableState.value.hotbarSlots.getOrNull(mutableState.value.selectedHotbar)
            ?.takeIf { ToolCompatibility.canHarvest(node.toolTags, setOf(it)) }
        val usedTool = if (node.toolTags.isEmpty()) null else selectedTool
            ?: tools.firstOrNull { ToolCompatibility.canHarvest(node.toolTags, setOf(it)) }
        if (!InventoryRules.canAdd(save.inventory, node.itemId, 1, itemMasses)) return notice("背包已满：${save.vitals.carriedMass.toInt()} / ${InventoryRules.capacity(save.inventory).toInt()} kg")
        val staminaCost = maxOf(2.0, node.hardness * 2.0 + 1.0)
        if (save.vitals.stamina < staminaCost) return notice("体力不足")
        val remaining = node.remaining - 1
        val updated = node.copy(
            remaining = remaining,
            state = if (remaining > 0) "hit" else "depleted",
            recoveryElapsedMinutes = if (remaining > 0) node.recoveryElapsedMinutes else 0.0,
        )
        val gathered = save.copy(
                resourceNodes = save.resourceNodes + (node.id to updated),
                inventory = save.inventory + (node.itemId to ((save.inventory[node.itemId] ?: 0) + 1)),
                milestones = save.milestones + ("item:${node.itemId}" to true) + ("collected:${node.itemId}" to true),
                vitals = save.vitals.copy(stamina = (save.vitals.stamina - staminaCost).coerceAtLeast(0.0)),
            )
        val afterWear = usedTool?.let { ToolDurabilityEngine.use(gathered, it, 1 + node.hardness / 2) } ?: gathered
        val broke = usedTool != null && (afterWear.inventory[usedTool] ?: 0) < (gathered.inventory[usedTool] ?: 0)
        val wasKnown = save.milestones["item:${node.itemId}"] == true
        val beforeItems = knownItems()
        val afterItems = beforeItems + node.itemId
        val stations = availableStations()
        val newlyVisible = if (wasKnown) emptyList() else RecipeUnlockPolicy.newlyVisibleRecipes(
            mutableState.value.recipes, beforeItems, afterItems, stations, stations,
        ).filter { it.station != "furnace" }
        mutableState.value = mutableState.value.copy(
            save = withCarriedMass(afterWear, itemMasses),
            nearbyResource = if (remaining > 0) updated else null,
            notice = if (broke) "获得 ${node.displayName} · ${mutableState.value.itemNames[usedTool] ?: usedTool}损坏" else "获得 ${node.displayName}",
            highlightedRecipeIds = if (wasKnown) mutableState.value.highlightedRecipeIds else newlyVisible.mapTo(mutableSetOf()) { it.id },
            unlockNotice = if (wasKnown) mutableState.value.unlockNotice else unlockNotice(node.itemId, newlyVisible),
        )
    }
    fun consume(itemId: String) = runCatching {
        val effect = ConsumableCatalog.effect(itemId) ?: error("这个物品不能直接食用")
        val result = withCarriedMass(ConsumptionEngine.consume(mutableState.value.save, itemId, effect), itemMasses)
        mutableState.value = mutableState.value.copy(save = result, notice = "已食用 ${mutableState.value.itemNames[itemId] ?: itemId}")
    }.onFailure { notice(it.message ?: "无法食用") }
    fun dropItem(itemId: String, amount: Int = 1) = runCatching {
        val dropped = NativeInventoryRules.drop(mutableState.value.save, itemId, amount, "${System.currentTimeMillis()}-$itemId")
        mutableState.value = mutableState.value.copy(save = withCarriedMass(dropped, itemMasses), notice = "已将 ${mutableState.value.itemNames[itemId] ?: itemId} ×$amount 丢到地面")
    }.onFailure { notice(it.message ?: "无法丢弃") }
    fun pickupGroundItem() = runCatching {
        val item = mutableState.value.nearbyGroundItem ?: error("附近没有可拾取物品")
        val picked = NativeInventoryRules.pickup(mutableState.value.save, item.id)
        mutableState.value = mutableState.value.copy(
            save = withCarriedMass(picked, itemMasses), nearbyGroundItem = null,
            notice = "已拾取 ${mutableState.value.itemNames[item.itemId] ?: item.itemId} ×${item.amount}",
        )
    }.onFailure { notice(it.message ?: "无法拾取") }
    fun useSelected() {
        val aboardMinecart = TransportRules.aboardMinecartId(mutableState.value.save)
            ?.let(mutableState.value.save.entities::get)
        val nearbyTransport = mutableState.value.nearbyEntity?.takeIf { it.type in TransportRules.interactiveTypes }
        val nearbyShelter = mutableState.value.nearbyEntity?.takeIf { it.type in ShelterRules.usableTypes }
        val nearbyStorage = mutableState.value.nearbyEntity?.takeIf { it.type == "storage-crate" }
        val nearbyFurnace = mutableState.value.nearbyEntity?.takeIf { it.type == "furnace" }
        val nearbyFarm = mutableState.value.nearbyEntity?.takeIf { it.type in setOf("farm-plot", "garden-plot") }
        val nearbyWorkbench = mutableState.value.nearbyEntity?.takeIf { it.type == "workbench" }
        when {
            aboardMinecart != null -> driveMinecart(aboardMinecart)
            nearbyTransport?.type == "rowboat" -> useBoat(nearbyTransport)
            nearbyTransport?.type == "minecart" -> useMinecart(nearbyTransport)
            nearbyTransport?.type == "rail-segment" -> notice("轨道已连接；将矿车放在轨道上即可乘坐")
            nearbyStorage != null -> openNearbyStorage()
            nearbyFurnace != null -> openNearbyFurnace()
            nearbyFarm != null -> openNearbyFarm()
            nearbyWorkbench != null -> openCrafting("workbench")
            mutableState.value.nearbyEntity?.let { NativeNpcRules.isVillager(it.type) } == true -> openNpc(mutableState.value.nearbyEntity!!)
            nearbyShelter != null -> {
                val rested = ShelterRules.rest(mutableState.value.save, nearbyShelter.type)
                mutableState.value = mutableState.value.copy(save = withCarriedMass(rested, itemMasses), notice = "已在庇护处休息到清晨")
            }
            mutableState.value.nearbyGroundItem != null -> pickupGroundItem()
            else -> harvestNearby()
        }
    }
    fun useHeldItem() {
        val itemId = mutableState.value.hotbarSlots.getOrNull(mutableState.value.selectedHotbar)
            ?.takeIf { (mutableState.value.save.inventory[it] ?: 0) > 0 }
            ?: return notice("先从快捷栏选择物品")
        val appearance = mutableState.value.items[itemId]
        when {
            ConsumableCatalog.effect(itemId) != null -> consume(itemId)
            itemId == "road-segment" -> placeRoadAhead()
            itemId == "rail-segment" -> placeRailAhead()
            appearance?.category == "building" -> beginPlacement(itemId)
            else -> notice("${appearance?.name ?: itemId}需要靠近对应目标使用")
        }
    }
    private fun placeRoadAhead() {
        val save = mutableState.value.save
        val player = save.players["local"]?.position ?: return notice("正在定位角色，请稍后再铺路")
        val origin = Coordinates(kotlin.math.round(player.x).toInt(), kotlin.math.round(player.y).toInt())
        val directions = listOf(1 to 0, 0 to 1, -1 to 0, 0 to -1)
        val candidates = (1..5).flatMap { distance -> directions.map { (dx, dy) -> Coordinates(origin.x + dx * distance, origin.y + dy * distance) } }
        val target = candidates.firstOrNull { coordinates ->
            ExplorationVisibility.contains(coordinates, save.discoveredChunks.keys) &&
                save.entities.values.none { it.coordinates == coordinates } &&
                WorldGenerator.sample(save.seed, coordinates.x.toDouble(), coordinates.y.toDouble()).biome != "lagoon"
        } ?: return notice(if (candidates.none { ExplorationVisibility.contains(it, save.discoveredChunks.keys) }) "先探索这片区域再铺路" else "身边没有可铺路的空地")
        mutate(GameCommand.Place("road-segment-${System.currentTimeMillis()}", "road-segment", target))
        mutableState.value = mutableState.value.copy(notice = "已在脚边铺好夯土路")
    }
    private fun placeRailAhead() {
        val save = mutableState.value.save
        if ((save.inventory["rail-segment"] ?: 0) < 1) return notice("背包里没有轨道组件")
        val player = save.players["local"]?.position ?: return notice("正在定位角色，请稍后再铺轨")
        val origin = Coordinates(kotlin.math.round(player.x).toInt(), kotlin.math.round(player.y).toInt())
        val rails = save.entities.values.filter { it.type == "rail-segment" }
        val candidates = listOf(
            Coordinates(origin.x + 1, origin.y), Coordinates(origin.x, origin.y + 1),
            Coordinates(origin.x - 1, origin.y), Coordinates(origin.x, origin.y - 1),
        )
        val target = candidates.firstOrNull { candidate ->
            ExplorationVisibility.contains(candidate, save.discoveredChunks.keys) &&
                save.entities.values.none { it.coordinates == candidate && it.type != "minecart" } &&
                (rails.isEmpty() || rails.any { kotlin.math.abs(it.coordinates.x - candidate.x) + kotlin.math.abs(it.coordinates.y - candidate.y) == 1 }) &&
                WorldGenerator.sample(save.seed, candidate.x.toDouble(), candidate.y.toDouble()).biome != "lagoon"
        } ?: return notice("轨道必须接在已有轨道的上下左右，并铺在已探索陆地")
        mutate(GameCommand.Place("rail-segment-${System.currentTimeMillis()}", "rail-segment", target))
        mutableState.value = mutableState.value.copy(notice = "轨道已与相邻轨道接通")
    }

    private fun useBoat(boat: Entity) = runCatching {
        val leaving = TransportRules.aboardBoatId(mutableState.value.save) == boat.id
        val next = TransportRules.toggleBoat(mutableState.value.save, boat)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(next, itemMasses), notice = if (leaving) "已从船上靠岸" else "已登船，再次使用即可靠岸")
    }.onFailure { notice(it.message ?: "现在无法使用船") }

    private fun useMinecart(cart: Entity) = runCatching {
        val next = TransportRules.toggleMinecart(mutableState.value.save, cart)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(next, itemMasses), notice = "已乘上矿车 · 点击行驶沿轨道前进")
    }.onFailure { notice(it.message ?: "现在无法乘坐矿车") }

    private fun driveMinecart(cart: Entity) = runCatching {
        val next = TransportRules.advanceMinecart(mutableState.value.save, cart)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(next, itemMasses), notice = "矿车沿连续轨道行驶")
    }.onFailure { notice(it.message ?: "前方轨道没有接通") }

    fun leaveMinecart() = runCatching {
        val cartId = TransportRules.aboardMinecartId(mutableState.value.save) ?: error("当前没有乘坐矿车")
        val cart = mutableState.value.save.entities[cartId] ?: error("矿车已不在这里")
        val next = TransportRules.toggleMinecart(mutableState.value.save, cart)
        mutableState.value = mutableState.value.copy(save = withCarriedMass(next, itemMasses), notice = "已从矿车旁下车")
    }.onFailure { notice(it.message ?: "现在无法下车") }
    fun discoverChunk(x: Int, y: Int) {
        val id = "$x,$y"
        if (id in mutableState.value.save.discoveredChunks) return
        val save = mutableState.value.save
        val sample = WorldGenerator.sample(save.seed, x * 16.0 + 8.0, y * 16.0 + 8.0)
        val clue = when (sample.biome) {
            "lagoon" -> "潮声里似乎夹着淡水流动的声音"
            "mangrove", "cloud-forest" -> "浓密林冠后还有未见过的植物"
            "basalt-ridge", "limestone-upland" -> "岩脊深处闪着矿脉的微光"
            "palm-grove" -> "远处椰林间像有旧营地的痕迹"
            "dry-savanna" -> "风吹过草原，留下动物迁徙的足印"
            else -> "地平线外还有新的岛屿线索"
        }
        mutableState.value = mutableState.value.copy(
            save = save.copy(discoveredChunks = save.discoveredChunks + (id to DiscoveredChunk(x, y))),
            notice = "发现 ${BiomePresentation.name(sample.biome)} · $clue",
        )
    }
    fun rememberPlayerPosition(position: PlayerPosition) {
        val save = mutableState.value.save
        val previous = save.players["local"]?.position
        if (previous == position) return
        val actuallyMoved = previous != null && kotlin.math.hypot(position.x - previous.x, position.y - previous.y) >= .15
        mutableState.value = mutableState.value.copy(
            save = save.withPlayerPosition("local", position).let { moved ->
                if (actuallyMoved) moved.copy(milestones = moved.milestones + ("tutorial:moved" to true)) else moved
            },
        )
    }
    fun acknowledgeIntro() {
        val save = mutableState.value.save
        mutableState.value = mutableState.value.copy(
            save = save.copy(milestones = save.milestones + ("tutorial:intro-seen" to true)),
            notice = "先轻点角色附近的空地走几步",
        )
    }
    fun rotateCamera(view: NativeGameView?) { view?.camera?.rotateQuarterTurn(); view?.invalidate() }
    private fun knownItems(): Set<String> = mutableState.value.save.milestones.filterValues { it }.keys
        .filter { it.startsWith("item:") }.mapTo(mutableSetOf()) { it.removePrefix("item:") }
        .apply { addAll(mutableState.value.save.inventory.filterValues { it > 0 }.keys) }
    private fun availableStations(): Set<String> = setOf("hand", mutableState.value.activeCraftStation)
    fun openCrafting(station: String = "hand") { mutableState.value = mutableState.value.copy(activePanel = GamePanel.CRAFTING, activeCraftStation = station) }
    private fun unlockNotice(itemId: String, recipes: List<RecipeDefinition>): UnlockNotice {
        val name = mutableState.value.itemNames[itemId] ?: itemId
        val line = if (recipes.isEmpty()) "已记录到图鉴" else "配方是 ${recipes.take(3).joinToString("、") { recipe -> mutableState.value.itemNames[recipe.outputItemId] ?: recipe.outputItemId }}"
        return UnlockNotice("解锁了 $name", line)
    }
    private fun mutate(command: GameCommand) { mutableState.value = mutableState.value.copy(save = withCarriedMass(Simulation.step(mutableState.value.save, command), itemMasses), notice = null) }
    private fun notice(text: String) { mutableState.value = mutableState.value.copy(notice = text) }

    companion object {
        const val SAVE_SLOT = "main"
        private fun withCarriedMass(save: GameSave, masses: Map<String, Double>): GameSave =
            save.copy(vitals = save.vitals.copy(carriedMass = InventoryRules.mass(save.inventory, masses)))
    }
}

@Composable
fun SurvivalDiaryApp(model: GameViewModel = viewModel()) {
    val state by model.state.collectAsState()
    val context = LocalContext.current
    val updater = remember(context) { UpdateRepository(context.applicationContext) }
    val scope = rememberCoroutineScope()
    var availableUpdate by remember { mutableStateOf<ReleaseUpdate?>(null) }
    var updateBusy by remember { mutableStateOf(false) }
    var updateMessage by remember { mutableStateOf<String?>(null) }
    var updateProgress by remember { mutableStateOf<DownloadProgress?>(null) }
    var showUpdateDialog by remember { mutableStateOf(false) }
    var showIntro by rememberSaveable { mutableStateOf(false) }
    var launchStage by rememberSaveable { mutableStateOf("launcher") }
    var confirmingNewWorld by rememberSaveable { mutableStateOf(false) }
    var nativeView by remember { mutableStateOf<NativeGameView?>(null) }
    val lifecycleOwner = LocalLifecycleOwner.current
    var foreground by remember { mutableStateOf(lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) foreground = true
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) { foreground = false; model.persistNow() }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    suspend fun checkUpdate(showLatest: Boolean) {
        updateBusy = true
        runCatching { withContext(Dispatchers.IO) { updater.fetchLatest(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE) } }
            .onSuccess {
                availableUpdate = it
                if (it != null) showUpdateDialog = true else if (showLatest) updateMessage = "已经是最新版本"
            }
            .onFailure { updateMessage = "检查更新失败，请稍后重试" }
        updateBusy = false
    }
    LaunchedEffect(Unit) {
        checkUpdate(false)
        while (true) {
            delay(1_000)
            if (foreground && launchStage == "playing") model.advanceClock()
        }
    }
    MaterialTheme(colorScheme = MaterialTheme.colorScheme.copy(primary = Color(0xFF176B62), secondary = Color(0xFFD99A4E))) {
        Box(Modifier.fillMaxSize()) {
            if (launchStage == "playing") {
                AndroidView(
                    factory = { NativeGameView(it).also { view ->
                        nativeView = view
                        view.onPlayerChunkChanged = model::discoverChunk
                        view.onPlayerPositionChanged = model::rememberPlayerPosition
                        view.onMovementChanged = model::setPlayerMoving
                        view.onMovementBlocked = model::reportMovementBlocked
                        view.onNearbyResourceChanged = model::setNearbyResource
                        view.onNearbyEntityChanged = model::setNearbyEntity
                        view.onNearbyGroundItemChanged = model::setNearbyGroundItem
                        view.onEntityTapped = model::openNpc
                        view.onBiomeChanged = model::setCurrentBiome
                        view.onPlacementRequested = model::placeAt
                    } },
                    update = {
                        it.updateContent(
                            state.buildingAppearances,
                            state.items,
                            state.resourceDefinitions,
                            state.biomeSpawns,
                        )
                        it.updateWorld(
                            state.save.seed,
                            state.save.discoveredChunks.keys.ifEmpty { setOf("0,0") },
                            state.save.resourceNodes,
                            state.save.entities.values,
                            state.save.groundItems.values,
                            state.save.weather.kind,
                            state.save.weather.intensity,
                            state.save.time,
                            state.placement?.itemId,
                            state.placement?.reason == null && state.placement != null,
                            state.placement?.coordinates,
                            state.save.players["local"]?.position,
                            TransportRules.aboardBoatId(state.save),
                            TransportRules.aboardMinecartId(state.save),
                        )
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                GameHud(state, model, { nativeView?.centerOnPlayer() })
                state.notice?.let { notice ->
                    LaunchedEffect(notice) { delay(2_200); model.clearNotice(notice) }
                }
                state.unlockNotice?.let { unlock ->
                    UnlockBanner(unlock, Modifier.align(androidx.compose.ui.Alignment.Center))
                    LaunchedEffect(unlock.key) { delay(3_200); model.clearUnlockNotice(unlock.key) }
                }
                state.placement?.let { PlacementControls(it, model) }
                when (state.activePanel) {
                    GamePanel.INVENTORY -> InventoryScreen(state, model, model::closePanel)
                    GamePanel.CRAFTING -> CraftingScreen(state, model::craft, { model.openPanel(GamePanel.COMPENDIUM) }, model::closePanel)
                    GamePanel.COMPENDIUM -> CompendiumScreen(state, model::closePanel)
                    GamePanel.NPC -> NpcScreen(
                        state, model::recruitNpc, model::npcHaul, model::npcRepair, model::npcTrade,
                        model::talkToNpc, model.npcConversation(state.nearbyEntity?.id), model::rememberNpcConversation,
                        model::closePanel,
                    )
                    GamePanel.STORAGE -> StorageScreen(state, model::depositToStorage, model::withdrawFromStorage, model::closePanel)
                    GamePanel.FURNACE -> FurnaceScreen(state, model::startFurnace, model::claimFurnace, model::closePanel)
                    GamePanel.FARM -> FarmScreen(state, model::plantCrop, model::waterCrop, model::harvestCrop, model::closePanel)
                    GamePanel.HANDBOOK -> CampHandbookScreen(
                        openCompendium = { model.openPanel(GamePanel.COMPENDIUM) },
                        openMap = { model.openPanel(GamePanel.MAP) },
                        openDiary = { model.openPanel(GamePanel.DIARY) },
                        openSystem = { model.openPanel(GamePanel.SYSTEM) },
                        openOnline = { model.openPanel(GamePanel.CHAT); model.refreshPublicIslands() },
                        close = model::closePanel,
                    )
                    GamePanel.MAP -> MapScreen(state.save, { model.openPanel(GamePanel.COMPENDIUM) }, model::closePanel)
                    GamePanel.DIARY -> DiaryScreen(state.save, state.itemNames, model::writeDiary, model::closePanel)
                    GamePanel.CHAT -> ChatPanel(state.online, model::refreshPublicIslands, model::createPublicIsland, model::joinPublicIsland, model::sendIslandChat, model::leaveOnline, model::closePanel)
                    GamePanel.SYSTEM -> SystemScreen(
                        version = BuildConfig.VERSION_NAME,
                        build = BuildConfig.VERSION_CODE,
                        checking = updateBusy,
                        update = availableUpdate,
                        onCheck = { scope.launch { checkUpdate(true) } },
                        onRestart = { model.restartWorld(); model.closePanel() },
                        close = model::closePanel,
                    )
                    GamePanel.NONE -> Unit
                }
            }
            updateMessage?.let { message ->
                Snackbar(Modifier.align(androidx.compose.ui.Alignment.TopCenter)) { Text(message) }
                LaunchedEffect(message) { delay(3_000); updateMessage = null }
            }
            if (launchStage == "playing" && showIntro) {
                // The opening chapter now teaches through one contextual HUD cue
                // at a time. Mark the legacy intro as seen without covering the
                // beach with a second, competing tutorial dialog.
                LaunchedEffect(launchStage, showIntro) {
                    model.acknowledgeIntro()
                    showIntro = false
                }
            }
            val candidate = availableUpdate
            if ((launchStage == "playing" || launchStage == "update") && !showIntro && showUpdateDialog && candidate != null) {
                GameDialog(
                    title = "发现新版本 ${candidate.version}",
                    onDismissRequest = { if (!updateBusy) { showUpdateDialog = false; if (launchStage == "update") launchStage = "launcher" } },
                    content = {
                        Text("更新包会下载到应用的 Downloads 目录，校验正式签名与完整性后交给系统安装器。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
                        updateProgress?.let { progress ->
                            if (progress.percent != null) LinearProgressIndicator(progress = { progress.percent / 100f }, modifier = Modifier.fillMaxWidth())
                            else LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                            Text(progress.percent?.let { "正在下载 $it%" } ?: "正在下载…", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall)
                        }
                    },
                    confirmButton = {
                        GameButton(
                            label = if (updateBusy) "下载中" else "下载并安装",
                            enabled = !updateBusy,
                            onClick = {
                                scope.launch {
                                    updateBusy = true
                                    updateProgress = DownloadProgress(0, -1, null)
                                    runCatching {
                                        withContext(Dispatchers.IO) {
                                            updater.downloadAndVerify(candidate) { progress -> scope.launch { updateProgress = progress } }
                                        }
                                    }.onSuccess {
                                        showUpdateDialog = false
                                        updateMessage = "下载完成，正在打开系统安装器"
                                        updater.openInstaller(it)
                                    }.onFailure { updateMessage = "更新下载或校验失败：${it.message ?: "未知错误"}" }
                                    updateBusy = false
                                    updateProgress = null
                                }
                            },
                        )
                    },
                    dismissButton = {
                        GameButton(
                            label = "稍后",
                            enabled = !updateBusy,
                            variant = GameButtonVariant.GHOST,
                            onClick = { showUpdateDialog = false; if (launchStage == "update") launchStage = "launcher" },
                        )
                    },
                )
            }
            if (launchStage == "launcher" || launchStage == "loading") {
                IslandLauncher(
                    ready = state.contentReady,
                    hasSave = state.hasExistingSave,
                    day = state.save.day,
                    loading = launchStage == "loading",
                    update = availableUpdate,
                    checkingUpdate = updateBusy,
                    onUpdate = { showIntro = false; showUpdateDialog = true; launchStage = "update" },
                    onContinue = { launchStage = "loading" },
                    onNewWorld = {
                        if (state.hasExistingSave) confirmingNewWorld = true
                        else { model.restartWorld(); showIntro = true; launchStage = "loading" }
                    },
                )
                LaunchedEffect(launchStage) {
                    if (launchStage == "loading") {
                        delay(760)
                        launchStage = "playing"
                    }
                }
            }
            if (confirmingNewWorld) {
                AlertDialog(
                    onDismissRequest = { confirmingNewWorld = false },
                    title = { Text("建立新的岛屿？") },
                    text = { Text("当前岛屿、背包、建筑与日记会被替换。") },
                    confirmButton = { TextButton(onClick = { model.restartWorld(); showIntro = true; confirmingNewWorld = false; launchStage = "loading" }) { Text("确认新建") } },
                    dismissButton = { TextButton(onClick = { confirmingNewWorld = false }) { Text("保留当前岛屿") } },
                )
            }
        }
    }
}

@Composable
private fun IslandLauncher(
    ready: Boolean,
    hasSave: Boolean,
    day: Int,
    loading: Boolean,
    update: ReleaseUpdate?,
    checkingUpdate: Boolean,
    onUpdate: () -> Unit,
    onContinue: () -> Unit,
    onNewWorld: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Color(0xFF0A211E)), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 430.dp).padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            Text("SURVIVAL DIARY", color = SurvivalTheme.Sun, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black)
            Text(if (loading) "潮声渐近" else "生存日记", color = SurvivalTheme.Paper, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black)
            Text(
                if (loading) "正在恢复天色、角色与营地状态……" else "岛屿没有写好的结局。先活下来，再决定这里会变成什么。",
                color = SurvivalTheme.PaperDim,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (loading) {
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 12.dp), color = SurvivalTheme.Sun, trackColor = Color.White.copy(alpha = .1f))
                Text("观察潮线、留意天色。你带走的每样东西都会改变下一步。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelSmall)
            } else {
                if (!ready) {
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = SurvivalTheme.Sun, trackColor = Color.White.copy(alpha = .1f))
                    Text("正在读取本机存档与岛屿资料", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelSmall)
                } else if (checkingUpdate) Text("正在检查版本", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelSmall)
                else if (update != null) GameButton("发现 ${update.version} build ${update.build} · 先更新", modifier = Modifier.fillMaxWidth(), onClick = onUpdate)
                else Text("启动检查完成 · 当前版本可继续游玩", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelSmall)
                if (ready && hasSave) {
                    Text("本机存档 · 第 $day 天 · 自动保存完好", color = Color(0xFFD9C18D), style = MaterialTheme.typography.labelMedium)
                    GameButton("继续岛屿", modifier = Modifier.fillMaxWidth(), onClick = onContinue)
                }
                if (ready) {
                    GameButton(
                        if (hasSave) "新建岛屿" else "开始新游戏 · 引导模式 A",
                        variant = GameButtonVariant.SECONDARY,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = onNewWorld,
                    )
                }
                Text("无需登录也能本地游玩；通行证用于联机与好友功能。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun GameDialog(
    title: String,
    onDismissRequest: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
    confirmButton: @Composable () -> Unit,
    dismissButton: @Composable (() -> Unit)? = null,
) {
    Box(
        Modifier.fillMaxSize().background(Color(0xCC000000)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 340.dp).padding(16.dp)
                .clip(SurvivalTheme.SheetShape)
                .border(1.dp, SurvivalTheme.Brass, SurvivalTheme.SheetShape)
                .background(SurvivalTheme.NightPanel)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(title, color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
            Spacer(Modifier.height(4.dp))
            confirmButton()
            dismissButton?.invoke()
        }
    }
}
