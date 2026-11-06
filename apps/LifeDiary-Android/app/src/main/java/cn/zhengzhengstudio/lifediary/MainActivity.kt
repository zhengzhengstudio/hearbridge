package cn.zhengzhengstudio.lifediary

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import cn.zhengzhengstudio.lifediary.auth.PassportManager
import cn.zhengzhengstudio.lifediary.ui.LifeDiaryApp
import cn.zhengzhengstudio.lifediary.ui.theme.LifeDiaryDesignTokens
import cn.zhengzhengstudio.lifediary.ui.theme.LifeTheme

class MainActivity : ComponentActivity() {
    private lateinit var passport: PassportManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        passport = PassportManager(this, AuthTokenStore(this))
        intent?.data?.let(passport::handleCallback)
        enableEdgeToEdge()
        setContent { LifeTheme { LifeDiaryApp(passportManager = passport) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let(passport::handleCallback)
    }
}
