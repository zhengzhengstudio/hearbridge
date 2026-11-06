package cn.zhengzhengstudio.lifediary

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

class NativeNavigationTest {
    @get:Rule val composeRule = createAndroidComposeRule<MainActivity>()
    @Test fun bottomNavigationOpensPrivateDiary() {
        composeRule.onNodeWithText("日记").performClick()
        composeRule.onNodeWithText("个人日记").assertIsDisplayed()
    }
}
