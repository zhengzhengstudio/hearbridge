package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun BoxScope.PlacementControls(draft: PlacementDraft, model: GameViewModel) {
    Column(
        Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(start = 12.dp, end = 12.dp, bottom = 86.dp)
            .background(Color(0xF5F3EAD7), SurvivalTheme.PanelShape).padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(draft.reason ?: "拖动镜头 · 点按地面移动预览 · 方向 ${draft.rotation}°", color = if (draft.reason == null) Color(0xFF164D3D) else Color(0xFF8B2E24))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GameButton(label = "旋转", onClick = model::rotatePlacement)
            GameButton(label = "确认放置", enabled = draft.reason == null, onClick = model::confirmPlacement)
            GameButton(label = "取消", variant = GameButtonVariant.GHOST, onClick = model::cancelPlacement)
        }
    }
}
