package com.example.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Session NOVA : URL du panneau + PANEL_TOKEN, persistés en
 * SharedPreferences (clé admin — l'appareil est personnel ; le stockage
 * chiffré Keystore est prévu en v2).
 *
 * Le token est envoyé au panneau en `Authorization: Bearer <token>` —
 * accepté sur toutes les routes /api/… (panelAuth.validBearer).
 */
object NovaSession {

    private const val PREFS = "nova_session"
    private const val KEY_URL = "panel_url"
    private const val KEY_TOKEN = "panel_token"

    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    var url: String
        get() = prefs.getString(KEY_URL, "")?.trim().orEmpty()
        set(value) = prefs.edit().putString(KEY_URL, value.trim()).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "")?.trim().orEmpty()
        set(value) = prefs.edit().putString(KEY_TOKEN, value.trim()).apply()

    fun isConfigured(): Boolean = url.isNotBlank() && token.isNotBlank()

    fun clear() {
        prefs.edit().remove(KEY_TOKEN).apply()
    }
}
