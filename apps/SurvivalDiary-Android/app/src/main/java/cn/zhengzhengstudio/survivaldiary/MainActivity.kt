package cn.zhengzhengstudio.survivaldiary

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import cn.zhengzhengstudio.survivaldiary.ui.GameViewModel
import cn.zhengzhengstudio.survivaldiary.ui.SurvivalDiaryApp

class MainActivity : ComponentActivity() {
    private val gameModel by viewModels<GameViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SurvivalDiaryApp(gameModel) }
    }

    override fun onStop() {
        gameModel.persistNow()
        super.onStop()
    }
}
