package cn.zhengzhengstudio.survivaldiary.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.*
import androidx.compose.animation.core.*
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun GamePanelSurface(
    title: String,
    subtitle: String,
    close: () -> Unit,
    frameAsset: String? = null,
    heightFraction: Float = 0.82f,
    content: @Composable ColumnScope.() -> Unit,
) {
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    val reveal by animateFloatAsState(if (entered) 1f else 0f, tween(220, easing = FastOutSlowInEasing), label = "panel-reveal")
    Box(Modifier.fillMaxSize().background(Color(0x99061110)).safeDrawingPadding(), contentAlignment = Alignment.BottomCenter) {
        Box(
            modifier = Modifier.fillMaxWidth().fillMaxHeight(heightFraction).padding(horizontal = 8.dp)
                .graphicsLayer { alpha = reveal; translationY = (1f - reveal) * 110f; scaleX = .98f + reveal * .02f }
                .background(Color(0xFA101C18), SurvivalTheme.SheetShape)
                .border(1.dp, SurvivalTheme.Brass, SurvivalTheme.SheetShape),
        ) {
            Box(
                Modifier.fillMaxWidth().height(82.dp).align(Alignment.TopCenter)
                    .background(Color(0x2B5D8A68), SurvivalTheme.SheetShape),
            )
            Column(Modifier.fillMaxSize().padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Box(Modifier.align(Alignment.CenterHorizontally).width(44.dp).height(3.dp).background(Color(0xFF856D43), androidx.compose.foundation.shape.RoundedCornerShape(2.dp)))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, Modifier.weight(1f), color = SurvivalTheme.Paper, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Box(
                        Modifier.widthIn(min = 96.dp).heightIn(min = 48.dp).clip(SurvivalTheme.PanelShape)
                            .border(1.dp, SurvivalTheme.Brass, SurvivalTheme.PanelShape)
                            .background(Color(0xD92B3F35))
                            .clickable(onClick = close)
                            .padding(horizontal = 11.dp, vertical = 7.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("回到岛上", color = SurvivalTheme.SunText, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(subtitle, color = SurvivalTheme.PaperDim, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0x665E735F)))
                Column(Modifier.fillMaxWidth().weight(1f)) { content() }
            }
        }
    }
}

@Composable
fun GameUiRaster(asset: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Fit) {
    val bitmap = rememberAssetImageBitmap(listOf("survival-v3/game/ui-v9/$asset.png"))
    bitmap?.let { Image(it, null, modifier, contentScale = contentScale) }
}

@Composable
internal fun rememberAssetImageBitmap(paths: List<String>): ImageBitmap? {
    val assets = LocalContext.current.applicationContext.assets
    return produceState<ImageBitmap?>(initialValue = null, key1 = paths) {
        value = withContext(Dispatchers.IO) {
            paths.firstNotNullOfOrNull { path ->
                runCatching { assets.open(path).use(BitmapFactory::decodeStream)?.asImageBitmap() }.getOrNull()
            }
        }
    }.value
}
