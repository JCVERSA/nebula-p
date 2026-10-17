package com.example.data

import com.example.model.BotStatus
import com.example.model.BotTelemetry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException

/**
 * Repository NOVA : source unique de vérité côté app.
 *
 *  - Poll /api/bot/status + /api/system/info + latence toutes les 5 s
 *  - Poll /api/bots + /api/bot/commands + /api/bot/users toutes les 30 s
 *  - 401 → sessionState UNAUTHENTICATED (le token a changé côté panneau)
 *  - erreurs réseau → CONNECTING (on continue d'essayer, jamais de données
 *    simulées : l'UI affiche l'état réel, y compris « injoignable »)
 */
object NovaRepository {

    enum class SessionState { NOT_CONFIGURED, CONNECTING, READY, UNAUTHENTICATED, UNREACHABLE }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    // 9.18ww — journal en direct : polling DÉDIÉ, démarré/arrêté par l'onglet
    // Journal (jamais en permanence — batterie). Pause = gel du
    // rafraîchissement, le contenu affiché reste.
    private var logsJob: Job? = null
    private val _logs = MutableStateFlow<String?>(null)
    val logs: StateFlow<String?> = _logs.asStateFlow()
    private val _logsPaused = MutableStateFlow(false)
    val logsPaused: StateFlow<Boolean> = _logsPaused.asStateFlow()
    private var api: NebulaApi? = null
    private var currentUrl: String = ""
    private var currentToken: String = ""

    private val _sessionState = MutableStateFlow(SessionState.NOT_CONFIGURED)
    val sessionState: StateFlow<SessionState> =
        _sessionState.asStateFlow()

    private val _botStatus = MutableStateFlow(BotStatus.DISCONNECTED)
    val botStatus: StateFlow<BotStatus> =
        _botStatus.asStateFlow()

    private val _qrCode = MutableStateFlow<String?>(null)
    val qrCode: StateFlow<String?> = _qrCode.asStateFlow()

    private val _systemInfo = MutableStateFlow(SystemInfoResponse())
    val systemInfo: StateFlow<SystemInfoResponse> = _systemInfo.asStateFlow()

    private val _bots = MutableStateFlow<List<BotEntryDto>>(emptyList())
    val bots: StateFlow<List<BotEntryDto>> = _bots.asStateFlow()

    private val _telemetry = MutableStateFlow(BotTelemetry())
    val telemetry: StateFlow<BotTelemetry> =
        _telemetry.asStateFlow()

    private val _toast = MutableStateFlow<String?>(null)
    val toast: kotlinx.coroutines.flow.StateFlow<String?> = _toast.asStateFlow()

    private var lastLatencyMs = 0
    private var lastErrorWasNetwork = false

    fun start() {
        if (pollJob?.isActive == true) return
        if (!NovaSession.isConfigured()) {
            _sessionState.value = SessionState.NOT_CONFIGURED
            return
        }
        reconfigure(NovaSession.url, NovaSession.token)
    }

    /** Configure (ou reconfigure après login) et (re)démarre le polling. */
    fun reconfigure(url: String, token: String) {
        currentUrl = url
        currentToken = token
        api = buildNebulaApi(url, token)
        _sessionState.value = SessionState.CONNECTING
        pollJob?.cancel()
        pollJob = scope.launch { pollLoop() }
    }

    fun clearToast() {
        _toast.value = null
    }

    fun showToast(message: String) {
        if (message.isNotBlank()) _toast.value = message
    }

    /**
     * Vérifie une URL+token avant de les sauver (LoginScreen).
     * 9.18i (audit B1) : /api/health est une SONDE PUBLIQUE — elle validait
     * n'importe quel token. On interroge /api/system/info, PROTÉGÉE :
     * mauvais token → 401 net à l'écran de connexion.
     */
    suspend fun verify(url: String, token: String): Result<Unit> {
        return try {
            buildNebulaApi(url, token).systemInfo()
            Result.success(Unit)
        } catch (e: HttpException) {
            if (e.code() == 401) {
                Result.failure(IllegalStateException("Token refusé par le panneau (401)."))
            } else {
                Result.failure(IllegalStateException("Le panneau a répondu ${e.code()}."))
            }
        } catch (e: IOException) {
            Result.failure(IllegalStateException("Panneau injoignable — vérifie l'URL et ta connexion."))
        } catch (e: Exception) {
            Result.failure(IllegalStateException(e.message ?: "Erreur inconnue."))
        }
    }

    /** Mesure fraîche de la latence (dialogue Diagnostic). */
    suspend fun measureLatency(): Int? {
        val started = System.nanoTime()
        return try {
            api()?.health()
            ((System.nanoTime() - started) / 1_000_000).toInt().coerceAtLeast(1)
        } catch (e: Exception) {
            null
        }
    }

    fun logout() {
        pollJob?.cancel()
        pollJob = null
        logsJob?.cancel()
        logsJob = null
        NovaSession.clear()
        api = null
        _sessionState.value = SessionState.NOT_CONFIGURED
        _bots.value = emptyList()
        _qrCode.value = null
        _telemetry.value = BotTelemetry()
    }

    private fun api(): NebulaApi? = api

    private suspend fun pollOnce(includeInventory: Boolean): Boolean {
        val a = api ?: return false
        return try {
            // Latence mesurée (appel le plus léger du panneau)
            val t0 = System.nanoTime()
            a.health()
            val latency = ((System.nanoTime() - t0) / 1_000_000).toInt().coerceAtLeast(1)
            val jitter = if (lastLatencyMs > 0) kotlin.math.abs(latency - lastLatencyMs) else 0
            lastLatencyMs = latency

            val status = a.botStatus()
            val info = a.systemInfo()

            _botStatus.value = when (status.status?.lowercase()) {
                "connected", "online", "ready" -> BotStatus.CONNECTED
                "connecting" -> BotStatus.CONNECTING
                "disconnecting", "stopping" -> BotStatus.DISCONNECTING
                else -> BotStatus.DISCONNECTED
            }
            _qrCode.value = status.qrCode?.takeIf { it.isNotBlank() }
            _systemInfo.value = info

            if (lastErrorWasNetwork || _sessionState.value == SessionState.CONNECTING) {
                _sessionState.value = SessionState.READY
            }
            lastErrorWasNetwork = false

            _telemetry.value = _telemetry.value.copy(
                uptimeSeconds = info.uptimeSeconds,
                latencyMs = latency,
                jitterMs = jitter
            )

            if (includeInventory) {
                try {
                    _bots.value = a.bots().bots
                    _telemetry.value = _telemetry.value.copy(
                        commandsTotal = a.commands().size,
                        usersTotal = a.users().total
                    )
                } catch (e: Exception) {
                    // L'inventaire peut échouer sans casser le statut principal
                }
            }
            true
        } catch (e: HttpException) {
            if (e.code() == 401) {
                _sessionState.value = SessionState.UNAUTHENTICATED
                pollJob?.cancel()
            } else {
                markUnreachable()
            }
            false
        } catch (e: Exception) {
            markUnreachable()
            false
        }
    }

    private suspend fun pollLoop() {
        var tick = 0L
        while (scope.isActive && pollJob?.isActive == true) {
            pollOnce(includeInventory = tick % 6 == 0L)
            tick++
            delay(5_000)
        }
    }

    /**
     * 9.18xx — télécommande : exécute le texte comme owner via le panneau.
     * Réponse asynchrone par callback (le résultat part dans le chat
     * WhatsApp de l'owner — Nova n'affiche que la confirmation).
     */
    fun runRemoteCommand(text: String, onResult: (ok: Boolean, message: String) -> Unit) {
        val a = api
        if (a == null || !NovaSession.isConfigured()) {
            onResult(false, "Session non configurée — vérifie Réglages → Connexion")
            return
        }
        scope.launch {
            try {
                val r = a.runCommand(RunCommandRequest(text))
                onResult(r.ok, r.message.ifBlank { if (r.ok) "✓ Exécuté" else "Refusé" })
            } catch (e: Exception) {
                onResult(false, "Panneau injoignable — ${e.message ?: "erreur réseau"}")
            }
        }
    }

    /** 9.18ww — journal : démarre le polling (no-op si déjà actif). */
    fun startLogsPolling() {
        if (logsJob?.isActive == true) return
        if (api == null) return
        logsJob = scope.launch {
            while (scope.isActive && logsJob?.isActive == true) {
                val a = api ?: break
                if (!_logsPaused.value) {
                    try {
                        _logs.value = a.logs(200).lines
                    } catch (e: Exception) {
                        // Le poll principal gère l'état réseau/session ; ici on
                        // garde les dernières lignes connues. Premier échec →
                        // état honnête « aucune ligne » plutôt qu'un chargement éternel.
                        if (_logs.value == null) _logs.value = ""
                    }
                }
                delay(5_000)
            }
        }
    }

    /** 9.18ww — journal : arrête le polling (onglet quitté). */
    fun stopLogsPolling() {
        logsJob?.cancel()
        logsJob = null
    }

    /** 9.18ww — journal : gèle/libère le rafraîchissement. */
    fun setLogsPaused(paused: Boolean) {
        _logsPaused.value = paused
    }

    /**
     * Rafraîchissement immédiat après une action (9.18i / audit B2) : le
     * statut WhatsApp d'un bot ne revient sinon qu'au prochain cycle —
     * 30 s pour l'inventaire. Ici : un poll complet incluant l'inventaire.
     */
    fun refreshNow() {
        if (api != null && NovaSession.isConfigured()) {
            scope.launch { pollOnce(includeInventory = true) }
        }
    }

    // Pas de companion : companion object est illégal dans un object Kotlin.
    // Fonctions membres — mêmes call sites (NovaRepository.displayStatusFor).

    /** Mappe un statut WhatsApp du superviseur vers l'état UI (null = inconnu). */
    fun statusFromWhatsapp(raw: String?): BotStatus? = when (raw?.lowercase()) {
        "connected", "online", "ready" -> BotStatus.CONNECTED
        "connecting" -> BotStatus.CONNECTING
        "disconnecting", "stopping" -> BotStatus.DISCONNECTING
        "disconnected", "offline", "stopped" -> BotStatus.DISCONNECTED
        else -> null
    }

    /**
     * Statut AFFICHÉ (9.18i / audit B2) : celui du bot SÉLECTIONNÉ
     * (via /api/bots), pas du bot par défaut — le squircle ne doit
     * jamais montrer l'état du bot A en agissant sur le bot B.
     * Repli sur le statut pollé (bot par défaut) si la liste est vide
     * ou que le statut WhatsApp est inconnu.
     */
    fun displayStatusFor(bots: List<BotEntryDto>, selectedId: String?, polled: BotStatus): BotStatus {
        val chosen = bots.firstOrNull { !selectedId.isNullOrBlank() && it.id == selectedId }
            ?: bots.firstOrNull { it.isDefault }
            ?: return polled
        return statusFromWhatsapp(chosen.whatsapp?.status) ?: polled
    }

    private fun markUnreachable() {
        lastErrorWasNetwork = true
        if (_sessionState.value != SessionState.UNAUTHENTICATED) {
            _sessionState.value = SessionState.UNREACHABLE
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────

    suspend fun toggleBot(id: String, currentlyConnected: Boolean): String {
        val a = api ?: return "Session non configurée."
        return try {
            val res = if (currentlyConnected) a.stopBot(id) else a.startBot(id)
            // Le squircle passe immédiatement en état transitoire honnête
            _botStatus.value = if (currentlyConnected) {
                BotStatus.DISCONNECTING
            } else {
                BotStatus.CONNECTING
            }
            res.bestMessage()
        } catch (e: HttpException) {
            "Erreur ${e.code()} — ${e.message()}"
        } catch (e: Exception) {
            "Panneau injoignable."
        }
    }

    suspend fun botAction(id: String, action: String): String {
        val a = api ?: return "Session non configurée."
        return try {
            val res = when (action) {
                "start" -> a.startBot(id)
                "stop" -> a.stopBot(id)
                "restart" -> a.restartBot(id)
                else -> return "Action inconnue."
            }
            res.bestMessage()
        } catch (e: HttpException) {
            "Erreur ${e.code()} — ${e.message()}"
        } catch (e: Exception) {
            "Panneau injoignable."
        }
    }

    suspend fun systemAction(action: String): String {
        val a = api ?: return "Session non configurée."
        return try {
            val res = when (action) {
                "update" -> a.systemUpdate()
                "restart" -> a.systemRestart()
                "stop" -> a.systemStop()
                else -> return "Action inconnue."
            }
            _toast.value = res.bestMessage()
            res.bestMessage()
        } catch (e: HttpException) {
            val msg = "Erreur ${e.code()} — ${e.message()}"
            _toast.value = msg
            msg
        } catch (e: Exception) {
            "Panneau injoignable."
        }
    }

}
