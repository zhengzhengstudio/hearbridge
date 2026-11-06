package cn.zhengzhengstudio.lifediary

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class PassportCredential(val accessToken: String, val accountId: String, val isMinor: Boolean)

interface AuthTokenStore {
    fun load(): PassportCredential?
    fun save(value: PassportCredential)
    fun clear()
}

class KeystoreAuthTokenStore(context: Context) : AuthTokenStore {
    private val preferences = context.getSharedPreferences("passport_secure", Context.MODE_PRIVATE)
    private val alias = "cn.zhengzhengstudio.lifediary.passport"

    override fun save(value: PassportCredential) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val plain = JSONObject().put("token", value.accessToken).put("account", value.accountId)
            .put("minor", value.isMinor).toString().toByteArray()
        preferences.edit().putString("blob", Base64.encodeToString(cipher.doFinal(plain), Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).apply()
    }

    override fun load(): PassportCredential? = runCatching {
        val blob = Base64.decode(preferences.getString("blob", null), Base64.NO_WRAP)
        val iv = Base64.decode(preferences.getString("iv", null), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        val json = JSONObject(String(cipher.doFinal(blob)))
        PassportCredential(json.getString("token"), json.getString("account"), json.optBoolean("minor"))
    }.getOrNull()

    override fun clear() { preferences.edit().clear().apply() }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
}

fun AuthTokenStore(context: Context): AuthTokenStore = KeystoreAuthTokenStore(context)
