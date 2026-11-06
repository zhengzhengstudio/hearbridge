package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

object SurvivalTheme {
    val Night = Color(0xF22B2118)
    val NightPanel = Color(0xFA17201C)
    val NightSoft = Color(0xF23A2D20)
    val Paper = Color(0xFFF2E7C9)
    val PaperDim = Color(0xFFBFCBC6)
    val Brass = Color(0xFF9A7140)
    val Sun = Color(0xFFE7A928)
    val SunText = Color(0xFFE1AD52)
    val Danger = Color(0xFFE36E5C)
    val BrownLine = Color(0xFF7D5D32)
    val BrownSoft = Color(0xFF4F5C46)

    val PanelShape: Shape = RoundedCornerShape(topStart = 9.dp, topEnd = 3.dp, bottomEnd = 9.dp, bottomStart = 5.dp)
    val DangerShape: Shape = RoundedCornerShape(topStart = 4.dp, topEnd = 12.dp, bottomEnd = 5.dp, bottomStart = 10.dp)
    val SheetShape: Shape = RoundedCornerShape(topStart = 18.dp, topEnd = 5.dp, bottomEnd = 0.dp, bottomStart = 0.dp)
    val HudShape: Shape = RoundedCornerShape(topStart = 10.dp, topEnd = 2.dp, bottomEnd = 6.dp, bottomStart = 3.dp)
}
