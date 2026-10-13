package com.example

import com.example.model.BotSelection
import com.example.model.BotStatus
import com.example.model.BotTelemetry
import com.example.model.NavTab
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * NOVA — tests des modèles (v1) : identité de l'app, formats honnêtes,
 * mapping d'états. Le repository n'est pas testé ici (il parle au réseau).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ExampleRobolectricTest {

    @Test
    fun `l'app s'appelle Nova`() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        assertEquals("Nova", context.getString(R.string.app_name))
    }

    @Test
    fun `uptime formate heures minutes secondes`() {
        assertEquals("00:00", BotTelemetry(uptimeSeconds = 0).formattedUptime())
        assertEquals("04:59", BotTelemetry(uptimeSeconds = 299).formattedUptime())
        assertEquals("01:00:00", BotTelemetry(uptimeSeconds = 3600).formattedUptime())
        assertEquals("27:46:39", BotTelemetry(uptimeSeconds = 999_999).formattedUptime())
    }

    @Test
    fun `placeholder de selection honnete quand aucun bot`() {
        val p = BotSelection.placeholder()
        assertEquals("", p.id)
        assertEquals("Aucun bot", p.name)
        assertEquals(0, p.latencyMs)
    }

    @Test
    fun `quatre etats de bot coherents`() {
        // Le bot WhatsApp suit exactement le cycle du squircle.
        assertEquals(4, BotStatus.entries.size)
        assertEquals(NavTab.HOME, NavTab.entries.first())
    }
}
