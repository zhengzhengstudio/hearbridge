package cn.zhengzhengstudio.lifediary.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Book
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Today
import androidx.compose.ui.graphics.vector.ImageVector

enum class LifeDestination(val route: String, val label: String, val icon: ImageVector) {
    Today("today", "今天", Icons.Outlined.Today),
    Diary("diary", "日记", Icons.Outlined.Book),
    Community("community", "公共日记", Icons.Outlined.Groups),
    Ledger("ledger", "记账", Icons.Outlined.AccountBalanceWallet),
    Companion("companion", "陪伴", Icons.Outlined.AutoAwesome),
    Profile("profile", "我的", Icons.Outlined.Person)
}
