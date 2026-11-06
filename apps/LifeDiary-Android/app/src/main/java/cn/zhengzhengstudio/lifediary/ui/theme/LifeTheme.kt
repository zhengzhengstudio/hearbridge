package cn.zhengzhengstudio.lifediary.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object LifeDiaryDesignTokens {
    val Pine = Color(0xFF175B42)
    val Moss = Color(0xFF3E725D)
    val Paper = Color(0xFFF3F7F4)
    val Canvas = Color(0xFFE2EBE6)
    val Ink = Color(0xFF17221C)
}

private val LightColors = lightColorScheme(
    primary = LifeDiaryDesignTokens.Pine,
    onPrimary = Color.White,
    secondary = LifeDiaryDesignTokens.Moss,
    tertiary = Color(0xFF5D7167),
    background = LifeDiaryDesignTokens.Paper,
    surface = Color(0xFFFAFCFB),
    surfaceVariant = LifeDiaryDesignTokens.Canvas,
    onBackground = LifeDiaryDesignTokens.Ink,
    onSurface = LifeDiaryDesignTokens.Ink
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFA7D3B5),
    secondary = Color(0xFFFFB4A6),
    background = Color(0xFF111713),
    surface = Color(0xFF18201B),
    surfaceVariant = Color(0xFF29342D)
)

@Composable
fun LifeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = MaterialTheme.typography,
        content = content
    )
}
