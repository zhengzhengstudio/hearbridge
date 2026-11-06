package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.survivaldiary.domain.NativeNpcRules
import kotlinx.coroutines.launch

@Composable
fun NpcScreen(
    state: GameUiState,
    recruit: () -> Unit,
    haul: () -> Unit,
    repair: () -> Unit,
    trade: (String) -> Unit,
    talk: suspend (String) -> NpcDialogueAnswer,
    initialConversation: NpcConversation?,
    rememberConversation: (NpcConversation) -> Unit,
    close: () -> Unit,
) {
    val npc = state.nearbyEntity ?: return
    val recruited = NativeNpcRules.isRecruited(state.save)
    val injuredAtuo = npc.id == NativeNpcRules.BUILDER_ID && npc.durability < npc.maxDurability
    val scope = rememberCoroutineScope()
    var question by remember(npc.id) { mutableStateOf("") }
    var lastQuestion by remember(npc.id, initialConversation?.reply) { mutableStateOf(initialConversation?.question.orEmpty()) }
    var answer by remember(npc.id, initialConversation?.reply) { mutableStateOf(initialConversation?.reply) }
    var answerSource by remember(npc.id, initialConversation?.reply) { mutableStateOf(initialConversation?.source.orEmpty()) }
    var merchantOffers by remember(npc.id) { mutableStateOf<List<NpcMerchantOffer>>(emptyList()) }
    var merchantHeadline by remember(npc.id) { mutableStateOf("") }
    var compassHint by remember(npc.id) { mutableStateOf<NpcCompassHint?>(null) }
    var gameFeedback by remember(npc.id) { mutableStateOf<NpcGameFeedback?>(null) }
    var asking by remember(npc.id) { mutableStateOf(false) }
    GamePanelSurface(
        if (injuredAtuo) "残骸后的呼喊" else "与 ${NativeNpcRules.name(npc)} 交谈",
        when (npc.type) {
            NativeNpcRules.TRADER_TYPE -> "交换岛上稀缺工具和种子，库存会真实结算"
            NativeNpcRules.FARMER_TYPE -> "用果实交换作物种子，帮助扩建农田"
            NativeNpcRules.WANDERER_TYPE -> "独自在岛上搭起的小基地；可以交谈，也愿意交换基础物资"
            else -> when {
                injuredAtuo -> "阿拓肋侧受伤、行动受限；先让两个人熬过今晚"
                recruited -> "会搬运物资并修理设施"
                else -> "需要一处床位、10 份食物和 10 份淡水，才愿意长期留下"
            }
        },
        close,
        frameAsset = "panel-frame",
    ) {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (injuredAtuo) {
                Box(Modifier.fillMaxWidth().clip(SurvivalTheme.PanelShape).background(Color(0xFF3C241F)).border(1.dp, Color(0xFFC97955), SurvivalTheme.PanelShape).padding(10.dp)) {
                    Text("受伤 · 无法远行  /  需要火、水和食物", color = Color(0xFFFFC19E), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                }
            }
            Text(if (injuredAtuo) "残骸边的话" else "篝火边的话", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
            Text(
                if (recruited) "已经加入营地；可以继续问路线、制作、农业或岛上的传闻。"
                else "不必先招募。直接输入你想说的话，招募只影响工作和营地权限。",
                color = SurvivalTheme.PaperDim,
                style = MaterialTheme.typography.bodySmall,
            )
            answer?.let {
                Box(Modifier.fillMaxWidth().clip(SurvivalTheme.PanelShape).background(Color(0xFF202A24)).border(1.dp, SurvivalTheme.BrownSoft, SurvivalTheme.PanelShape).padding(10.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (lastQuestion.isNotBlank()) Text("你：$lastQuestion", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelMedium)
                        Text("${NativeNpcRules.name(npc)}：$it", color = SurvivalTheme.Paper, style = MaterialTheme.typography.bodyMedium)
                        Text(answerSource, style = MaterialTheme.typography.labelSmall, color = SurvivalTheme.Sun)
                    }
                }
            }
            BasicTextField(
                value = question,
                onValueChange = { question = it.take(240) },
                modifier = Modifier.fillMaxWidth().clip(SurvivalTheme.PanelShape).background(Color(0xFF202A24)).border(1.dp, SurvivalTheme.BrownSoft, SurvivalTheme.PanelShape).padding(12.dp),
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = SurvivalTheme.Paper),
                cursorBrush = SolidColor(SurvivalTheme.Sun),
                enabled = !asking,
                decorationBox = { innerTextField ->
                    Box {
                        if (question.isEmpty()) Text("和${NativeNpcRules.name(npc)}说……", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
                        innerTextField()
                    }
                },
            )
            GameButton(
                label = if (asking) "岛民已回答 · Kimi 最多再等 2.6 秒" else "说给 ${NativeNpcRules.name(npc)} 听",
                enabled = question.isNotBlank() && !asking,
                onClick = {
                    val prompt = question.trim()
                    if (prompt.isNotEmpty()) scope.launch {
                        asking = true
                        lastQuestion = prompt
                        answer = NativeNpcRules.localDialogue(npc, prompt, recruited)
                        answerSource = "岛民先答 · Kimi 快速回话中（最多 2.6 秒）"
                        rememberConversation(NpcConversation(npc.id, prompt, answer.orEmpty(), answerSource))
                        val result = talk(prompt)
                        answer = result.reply.trim().takeIf(String::isNotEmpty) ?: answer
                        answerSource = result.source
                        rememberConversation(NpcConversation(npc.id, prompt, answer.orEmpty(), answerSource))
                        merchantOffers = result.merchantOffers
                        merchantHeadline = result.merchantHeadline
                        compassHint = result.compassHint
                        gameFeedback = result.gameFeedback
                        question = ""
                        asking = false
                    }
                },
            )
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFF42534E)))
            compassHint?.let { hint ->
                Text("指南针标记 · ${hint.label}", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold)
                Text(hint.reason, color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall)
            }
            gameFeedback?.let { feedback ->
                Text("岛上建议 · ${feedback.message}", color = SurvivalTheme.Paper, style = MaterialTheme.typography.bodySmall)
            }
            if (npc.type == NativeNpcRules.TRADER_TYPE && merchantOffers.isNotEmpty()) {
                Text(merchantHeadline.ifBlank { "岚商今日特别货箱" }, color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                Text("Kimi 负责挑选，实际价格和背包结算仍由游戏规则控制。", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.labelSmall)
                merchantOffers.forEach { offer ->
                    GameButton(
                        label = "${offer.name} · ${offer.giveName}×${offer.giveAmount} → ${offer.receiveName}×${offer.receiveAmount}",
                        variant = GameButtonVariant.GHOST,
                        onClick = { trade(offer.id) },
                    )
                    if (offer.rarity.isNotBlank() || offer.description.isNotBlank()) Text(
                        listOf(offer.rarity, offer.description).filter(String::isNotBlank).joinToString(" · "),
                        color = SurvivalTheme.PaperDim,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
                Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFF42534E)))
            }
            when (npc.type) {
                NativeNpcRules.TRADER_TYPE -> {
                    Text("“矿石和结实的石料，在岛上总有用处。”", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
                    GameButton(label = "石头 ×3 → 粟种 ×2", onClick = { trade("stone-for-millet") })
                    GameButton(label = "铁矿石 ×1 → 维修包 ×1", variant = GameButtonVariant.GHOST, onClick = { trade("iron-for-repair") })
                    Text("出售给幸存者", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GameButton(label = "铁矿 → 贝币×5", variant = GameButtonVariant.GHOST, modifier = Modifier.weight(1f), onClick = { trade("sell-iron") })
                        GameButton(label = "石英×2 → 贝币×4", variant = GameButtonVariant.GHOST, modifier = Modifier.weight(1f), onClick = { trade("sell-quartz") })
                    }
                    GameButton(label = "贝币 ×3 → 绳索 ×1", onClick = { trade("tokens-for-rope") })
                }
                NativeNpcRules.FARMER_TYPE -> {
                    Text("“把果实留下，我给你能继续种下去的种子。”", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
                    GameButton(label = "浆果 ×3 → 药草种子 ×2", onClick = { trade("berry-for-herb") })
                    GameButton(label = "椰子 ×2 → 芋种 ×2", variant = GameButtonVariant.GHOST, onClick = { trade("coconut-for-taro") })
                    Text("出售给幸存者", color = SurvivalTheme.Sun, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GameButton(label = "椰子×2 → 贝币×2", variant = GameButtonVariant.GHOST, modifier = Modifier.weight(1f), onClick = { trade("sell-food") })
                        GameButton(label = "药草×3 → 贝币×3", variant = GameButtonVariant.GHOST, modifier = Modifier.weight(1f), onClick = { trade("sell-herb") })
                    }
                    GameButton(label = "贝币 ×2 → 芋种 ×2", onClick = { trade("tokens-for-taro") })
                }
                NativeNpcRules.WANDERER_TYPE -> {
                    Text("“路上捡来的材料不多，但可以互相换些急用的。”", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
                    GameButton(label = "树枝 ×4 → 贝币 ×1", variant = GameButtonVariant.GHOST, onClick = { trade("sell-branches") })
                    GameButton(label = "贝币 ×2 → 椰子 ×1", onClick = { trade("tokens-for-coconut") })
                }
                else -> {
                    Text(if (recruited) "“今天先把最重的东西收好。坏掉的设施交给我。”" else "“我能帮你干活，但今晚总得有地方睡，也得有吃有喝。”", color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodyMedium)
                    if (!recruited) GameButton(label = "邀请加入营地", onClick = recruit)
                    else {
                        GameButton(label = "搬运 · 最多 4 份材料到储物箱", onClick = haul)
                        GameButton(label = "修理 · 消耗 1 份修理包", variant = GameButtonVariant.GHOST, onClick = repair)
                    }
                }
            }
        }
    }
}
