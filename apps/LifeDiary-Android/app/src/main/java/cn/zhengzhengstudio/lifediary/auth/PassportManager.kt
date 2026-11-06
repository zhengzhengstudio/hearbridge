package cn.zhengzhengstudio.lifediary.auth

import android.app.Activity
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import cn.zhengzhengstudio.lifediary.AuthTokenStore
import cn.zhengzhengstudio.lifediary.BuildConfig
import cn.zhengzhengstudio.lifediary.PassportCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

sealed interface PassportState {
    data object SignedOut : PassportState
    data object Authorizing : PassportState
    data class SignedIn(val credential: PassportCredential) : PassportState
    data class Failed(val message: String) : PassportState
}

class PassportManager(private val activity: Activity, private val tokens: AuthTokenStore) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow<PassportState>(tokens.load()?.let { PassportState.SignedIn(it) } ?: PassportState.SignedOut)
    val state: StateFlow<PassportState> = _state
    private var expectedState: String? = null
    private var expectedNonce: String? = null
    private var verifier: String? = null

    fun signIn() {
        val state = randomUrlValue(32)
        val nonce = randomUrlValue(32)
        val codeVerifier = randomUrlValue(64)
        expectedState = state; expectedNonce = nonce; verifier = codeVerifier
        _state.value = PassportState.Authorizing
        val challenge = encode(MessageDigest.getInstance("SHA-256").digest(codeVerifier.toByteArray()))
        val uri = Uri.parse("${BuildConfig.API_BASE_URL}/api/zz-pass/native/authorize").buildUpon()
            .appendQueryParameter("app_id", APP_ID)
            .appendQueryParameter("redirect_uri", REDIRECT_URI)
            .appendQueryParameter("state", state).appendQueryParameter("nonce", nonce)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256").build()
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri)
    }

    fun handleCallback(uri: Uri) {
        if (uri.toString().substringBefore('?') != REDIRECT_URI || uri.getQueryParameter("state") != expectedState) {
            _state.value = PassportState.Failed("登录回调校验失败")
            return
        }
        val code = uri.getQueryParameter("code") ?: return fail("登录凭据缺失")
        val codeVerifier = verifier ?: return fail("登录会话已过期")
        scope.launch {
            runCatching { exchange(code, codeVerifier) }
                .onSuccess { credential -> tokens.save(credential); _state.value = PassportState.SignedIn(credential); clearAttempt() }
                .onFailure { fail(it.message ?: "登录失败"); clearAttempt() }
        }
    }

    fun signOut() { tokens.clear(); clearAttempt(); _state.value = PassportState.SignedOut }
    fun accessToken(): String? = (_state.value as? PassportState.SignedIn)?.credential?.accessToken

    private fun exchange(code: String, codeVerifier: String): PassportCredential {
        val body = JSONObject().put("code", code).put("app_id", APP_ID)
            .put("redirect_uri", REDIRECT_URI).put("code_verifier", codeVerifier).toString()
        val connection = (URL("${BuildConfig.API_BASE_URL}/api/zz-pass/native/exchange").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 10_000; readTimeout = 10_000
            setRequestProperty("Content-Type", "application/json"); doOutput = true
        }
        connection.outputStream.use { it.write(body.toByteArray()) }
        check(connection.responseCode in 200..299) { "通行证交换失败 (${connection.responseCode})" }
        val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        check(json.optString("nonce") == expectedNonce) { "登录 nonce 校验失败" }
        return PassportCredential(json.getString("access_token"), json.getString("account_id"), json.optBoolean("is_minor"))
    }

    private fun fail(message: String) { _state.value = PassportState.Failed(message) }
    private fun clearAttempt() { expectedState = null; expectedNonce = null; verifier = null }
    private fun randomUrlValue(bytes: Int) = ByteArray(bytes).also(SecureRandom()::nextBytes).let(::encode)
    private fun encode(value: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(value)

    companion object { const val APP_ID = "lifediary-android"; const val REDIRECT_URI = "lifediary://passport/callback" }
}
