package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalView
import android.view.HapticFeedbackConstants
import android.view.SoundEffectConstants

enum class GameButtonVariant { PRIMARY, SECONDARY, DANGER, GHOST }

@Composable
fun GameButton(
    label: String,
    enabled: Boolean = true,
    variant: GameButtonVariant = GameButtonVariant.PRIMARY,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val hostView = LocalView.current
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && enabled) 0.975f else 1f, label = "game-button-press")
    val (bg, border, textColor) = when (variant) {
        GameButtonVariant.PRIMARY -> Triple(Color(0xF036604D), SurvivalTheme.Sun, SurvivalTheme.Paper)
        GameButtonVariant.SECONDARY -> Triple(Color(0xE62B3D34), Color(0xFF8C7651), SurvivalTheme.Paper)
        GameButtonVariant.DANGER -> Triple(Color(0xD95C2E24), SurvivalTheme.Danger, SurvivalTheme.Paper)
        GameButtonVariant.GHOST -> Triple(Color(0xB31B2924), Color(0xFF52655A), SurvivalTheme.PaperDim)
    }
    val finalText = if (enabled) textColor else Color(0xFF7A7568)
    val finalBorder = if (enabled) border else Color(0xFF4A4038)
    val finalBg = if (enabled) bg else Color(0xFF2A2620)
    Box(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale; translationY = if (pressed && enabled) 1.dp.toPx() else 0f }
            .heightIn(min = 48.dp)
            .clip(SurvivalTheme.PanelShape)
            .border(1.dp, finalBorder, SurvivalTheme.PanelShape)
            .background(finalBg)
            .clickable(enabled = enabled, interactionSource = interaction, indication = null) {
                hostView.playSoundEffect(SoundEffectConstants.CLICK)
                hostView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                onClick()
            }
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = finalText, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
    }
}
