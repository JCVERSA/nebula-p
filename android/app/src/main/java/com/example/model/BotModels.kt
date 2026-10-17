package com.example.model

/**
 * NOVA — modèles UI (transplant VPN → Nebula, 9.18h).
 *
 * Les noms d'états sont volontairement identiques à ceux du template VPN
 * (DISCONNECTED/CONNECTING/CONNECTED/DISCONNECTING) : ils décrivent
 * exactement le bot WhatsApp (hors ligne / en connexion / en ligne /
 * arrêt en cours) et permettent de conserver les composants animés du
 * propriétaire sans aucune retouche.
 */

enum class BotStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    DISCONNECTING
}

enum class NavTab(val title: String) {
    HOME("Home"),
    BOTS("Bots"),
    LOGS("Journal"),
    REMOTE("Télécommande"),
    SETTINGS("Settings")
}

/**
 * Sélection affichée dans le sélecteur de bot (ex-ligne « serveur »).
 * Toutes les valeurs sont RÉELLES : nom du bot, port moteur, latence
 * mesurée vers le panneau.
 */
data class BotSelection(
    val id: String,
    val name: String,
    val subtitle: String,
    val emoji: String,
    val latencyMs: Int,
    val isDefault: Boolean = false,
    val enginePort: Int = 0
) {
    companion object {
        fun placeholder(): BotSelection = BotSelection(
            id = "",
            name = "Aucun bot",
            subtitle = "vérifie la connexion au panneau",
            emoji = "🤖",
            latencyMs = 0
        )
    }
}

/**
 * Télémétrie RÉELLE du déploiement (honnêteté UI — aucune valeur simulée) :
 *  - uptimeSeconds : uptime du panneau (/api/system/info)
 *  - latencyMs / jitterMs : latence réseau mesurée vers le panneau et sa
 *    variation entre deux polls (affichés par la wave en direct)
 *  - commandsTotal : nombre de commandes enregistrées (/api/bot/commands)
 *  - usersTotal : utilisateurs connus (/api/bot/users)
 */
data class BotTelemetry(
    val uptimeSeconds: Long = 0,
    val latencyMs: Int = 0,
    val jitterMs: Int = 0,
    val commandsTotal: Int = 0,
    val usersTotal: Int = 0
) {
    fun formattedUptime(): String {
        val hours = uptimeSeconds / 3600
        val minutes = (uptimeSeconds % 3600) / 60
        val seconds = uptimeSeconds % 60
        return if (hours > 0) {
            String.format("%02d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format("%02d:%02d", minutes, seconds)
        }
    }
}
