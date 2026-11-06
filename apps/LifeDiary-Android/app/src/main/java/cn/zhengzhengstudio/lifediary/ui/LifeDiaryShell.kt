package cn.zhengzhengstudio.lifediary.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import cn.zhengzhengstudio.lifediary.navigation.LifeDestination

@Composable
fun LifeDiaryShell(
    selected: LifeDestination,
    onSelect: (LifeDestination) -> Unit,
    content: @Composable () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) { content() }
        LifeDiaryNavBar(selected = selected, onSelect = onSelect)
    }
}

@Composable
private fun LifeDiaryNavBar(selected: LifeDestination, onSelect: (LifeDestination) -> Unit) {
    Surface(
        tonalElevation = 0.dp,
        shadowElevation = 4.dp,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            LifeDestination.entries.forEach { dest ->
                LifeNavItem(dest = dest, active = dest == selected, onClick = { onSelect(dest) })
            }
        }
    }
}

@Composable
private fun LifeNavItem(dest: LifeDestination, active: Boolean, onClick: () -> Unit) {
    val activeColor = MaterialTheme.colorScheme.primary
    val idleColor = MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        Icon(
            imageVector = dest.icon,
            contentDescription = dest.label,
            tint = if (active) activeColor else idleColor
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            dest.label,
            style = MaterialTheme.typography.labelSmall,
            color = if (active) activeColor else idleColor
        )
    }
}
