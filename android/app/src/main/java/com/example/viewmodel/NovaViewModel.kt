package com.example.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.BotEntryDto
import com.example.data.NovaRepository
import com.example.model.BotSelection
import com.example.model.BotStatus
import com.example.model.NavTab
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * NOVA — ViewModel unique (v1) : expose les flows du repository au UI et
 * porte les actions. Aucune donnée simulée : tout vient du panneau.
 */
class NovaViewModel : ViewModel() {

    val sessionState: StateFlow<NovaRepository.SessionState> = NovaRepository.sessionState
    val botStatus: StateFlow<BotStatus> = NovaRepository.botStatus
    val qrCode: StateFlow<String?> = NovaRepository.qrCode
    val systemInfo: StateFlow<com.example.data.SystemInfoResponse> = NovaRepository.systemInfo
    val bots: StateFlow<List<BotEntryDto>> = NovaRepository.bots
    val telemetry: StateFlow<com.example.model.BotTelemetry> = NovaRepository.telemetry
    val toast: StateFlow<String?> = NovaRepository.toast
    val logs: StateFlow<String?> = NovaRepository.logs
    val logsPaused: StateFlow<Boolean> = NovaRepository.logsPaused

    private val _activeTab = MutableStateFlow(NavTab.HOME)
    val activeTab: StateFlow<NavTab> = _activeTab.asStateFlow()

    /** Latence fraîche mesurée par le dialogue Diagnostic (null = injoignable). */
    private val _diagLatency = MutableStateFlow<Int?>(null)
    val diagLatency: StateFlow<Int?> = _diagLatency.asStateFlow()

    private val _selectedBotId = MutableStateFlow<String?>(null)
    val selectedBotId: StateFlow<String?> = _selectedBotId.asStateFlow()

    fun start() = NovaRepository.start()

    fun setActiveTab(tab: NavTab) {
        _activeTab.value = tab
    }

    fun clearToast() = NovaRepository.clearToast()

    /** 9.18xx — télécommande : exécute un texte comme owner. */
    fun runRemoteCommand(text: String, onResult: (ok: Boolean, message: String) -> Unit) =
        NovaRepository.runRemoteCommand(text, onResult)

    /** 9.18ww — journal : polling lié au cycle de vie de l'onglet. */
    fun startLogsPolling() = NovaRepository.startLogsPolling()
    fun stopLogsPolling() = NovaRepository.stopLogsPolling()
    fun setLogsPaused(paused: Boolean) = NovaRepository.setLogsPaused(paused)

    fun selectBot(id: String) {
        _selectedBotId.value = id
        _activeTab.value = NavTab.HOME
    }

    /** Bot affiché dans le sélecteur du Home (défaut = bot par défaut du panneau). */
    fun selectedSelection(): BotSelection {
        val list = bots.value
        if (list.isEmpty()) return BotSelection.placeholder()
        val chosen = list.firstOrNull { it.id == _selectedBotId.value }
            ?: list.firstOrNull { it.isDefault }
            ?: list.first()
        return BotSelection(
            id = chosen.id,
            name = chosen.name.ifBlank { chosen.id },
            subtitle = buildString {
                if (chosen.isDefault) append("défaut • ")
                append("port ${chosen.enginePort}")
                chosen.whatsapp?.status?.let { append(" • WhatsApp $it") }
            },
            emoji = if (chosen.isDefault) "⭐" else "🤖",
            latencyMs = telemetry.value.latencyMs,
            isDefault = chosen.isDefault,
            enginePort = chosen.enginePort
        )
    }

    /**
     * Statut affiché : celui du bot sélectionné (9.18i / audit B2) —
     * cohérence squircle/action garantie.
     */
    fun displayStatus(): BotStatus =
        NovaRepository.displayStatusFor(bots.value, _selectedBotId.value, botStatus.value)

    /** Squircle : démarre/arrête le bot sélectionné (ou par défaut). */
    fun toggleConnect() {
        val id = selectedSelection().id
        if (id.isBlank()) return
        viewModelScope.launch {
            val msg = NovaRepository.toggleBot(id, displayStatus() == BotStatus.CONNECTED)
            NovaRepository.showToast(msg)
            NovaRepository.refreshNow()
        }
    }

    fun botAction(id: String, action: String) {
        viewModelScope.launch {
            NovaRepository.botAction(id, action)
            NovaRepository.refreshNow()
        }
    }

    fun systemAction(action: String) {
        viewModelScope.launch {
            NovaRepository.systemAction(action)
        }
    }

    /** Diagnostic réseau : mesure fraîche de la latence (dialogue). */
    fun runDiagnostic() {
        _diagLatency.value = null
        viewModelScope.launch {
            _diagLatency.value = NovaRepository.measureLatency()
        }
    }

    fun logout() {
        NovaRepository.logout()
    }

}
