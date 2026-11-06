package cn.zhengzhengstudio.survivaldiary.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.graphicsLayer

@Composable
fun UnlockBanner(notice: UnlockNotice, modifier: Modifier = Modifier) {
    val pulse by rememberInfiniteTransition(label = "unlock").animateFloat(
        initialValue = .96f, targetValue = 1.03f,
        animationSpec = infiniteRepeatable(tween(480, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "unlock-pulse",
    )
    Column(
        modifier.graphicsLayer { scaleX = pulse; scaleY = pulse }.widthIn(min = 230.dp, max = 420.dp)
            .background(Color(0xF22B2118), RoundedCornerShape(7.dp))
            .border(2.dp, Color(0xFFE7A928), RoundedCornerShape(7.dp))
            .padding(horizontal = 22.dp, vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(notice.title, color = Color(0xFFFFD36A), fontWeight = FontWeight.Black)
        Text(notice.recipeLine, color = Color(0xFFF2E7C9), style = MaterialTheme.typography.bodySmall)
    }
}
