package com.example.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.data.NovaRepository
import com.example.data.NovaSession
import com.example.model.NavTab
import com.example.ui.components.BottomNavBar
import com.example.ui.components.SlateMark
import com.example.ui.components.SlateMotionProvider
import com.example.ui.components.SwiftSlateSpinner
import com.example.ui.components.bounceClick
import com.example.ui.screens.BotsScreen
import com.example.ui.screens.HomeScreen
import com.example.ui.screens.LoginScreen
import com.example.ui.screens.SettingsScreen
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkBackground
import com.example.ui.theme.DarkSurface
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.viewmodel.NovaViewModel

/**
 * NOVA — racine de l'UI : porte de connexion (login) si la session n'est
 * pas configurée, sinon le shell à onglets (Home / Bots / Réglages).
 */
@Composable
fun MainScreen(
    viewModel: NovaViewModel = viewModel()
) {
    SlateMotionProvider {
        val sessionState by viewModel.sessionState.collectAsStateWithLifecycle()

        // Démarre le polling (no-op s'il tourne déjà) dès le premier affichage.
        LaunchedEffect(Unit) { viewModel.start() }

        // 9.18i (audit B3) : clé révoquée côté panneau (401 au poll) → retour
        // immédiat à l'écran de connexion, pas un shell au statut douteux.
        if (sessionState == NovaRepository.SessionState.NOT_CONFIGURED ||
            sessionState == NovaRepository.SessionState.UNAUTHENTICATED
        ) {
            LoginScreen(onLoggedIn = { })
            return@SlateMotionProvider
        }

        val status by viewModel.botStatus.collectAsStateWithLifecycle()
        val qrCode by viewModel.qrCode.collectAsStateWithLifecycle()
        val systemInfo by viewModel.systemInfo.collectAsStateWithLifecycle()
        val bots by viewModel.bots.collectAsStateWithLifecycle()
        val telemetry by viewModel.telemetry.collectAsStateWithLifecycle()
        val activeTab by viewModel.activeTab.collectAsStateWithLifecycle()
        val toastMessage by viewModel.toast.collectAsStateWithLifecycle()
        val selectedBotId by viewModel.selectedBotId.collectAsStateWithLifecycle()
        val diagLatency by viewModel.diagLatency.collectAsStateWithLifecycle()

        // 9.18i (audit B2) : statut du bot AFFICHÉ = celui du bot sélectionné
        // (repli : bot par défaut / statut pollé). Le QR n'appartient qu'au
        // moteur PAR DÉFAUT (/api/bot/status) — masqué pour un autre bot.
        val displayStatus = NovaRepository.displayStatusFor(bots, selectedBotId, status)
        val displayedBotIsDefault = (
            bots.firstOrNull { it.id == selectedBotId } ?: bots.firstOrNull { it.isDefault }
            )?.isDefault ?: true

        val snackbarHostState = remember { SnackbarHostState() }
        var showDiagnosticsDialog by remember { mutableStateOf(false) }
        var showAboutDialog by remember { mutableStateOf(false) }

        LaunchedEffect(toastMessage) {
            toastMessage?.let { msg ->
                snackbarHostState.showSnackbar(msg)
                viewModel.clearToast()
            }
        }

        BackHandler(enabled = activeTab != NavTab.HOME) {
            viewModel.setActiveTab(NavTab.HOME)
        }

        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .testTag("app_main_scaffold"),
            containerColor = DarkBackground,
            snackbarHost = { SnackbarHost(snackbarHostState) },
            bottomBar = {
                BottomNavBar(
                    selectedTab = activeTab,
                    onTabSelected = { viewModel.setActiveTab(it) }
                )
            }
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                AnimatedContent(
                    targetState = activeTab,
                    transitionSpec = {
                        if (targetState.ordinal > initialState.ordinal) {
                            (slideInHorizontally(tween(260)) { width -> width / 4 } + fadeIn(tween(220)))
                                .togetherWith(slideOutHorizontally(tween(200)) { width -> -width / 4 } + fadeOut(tween(180)))
                        } else {
                            (slideInHorizontally(tween(260)) { width -> -width / 4 } + fadeIn(tween(220)))
                                .togetherWith(slideOutHorizontally(tween(200)) { width -> width / 4 } + fadeOut(tween(180)))
                        }
                    },
                    label = "tab_animated_content"
                ) { currentTab ->
                    when (currentTab) {
                        NavTab.HOME -> {
                            HomeScreen(
                                status = displayStatus,
                                selection = viewModel.selectedSelection(),
                                telemetry = telemetry,
                                commitLabel = systemInfo.commit?.take(7) ?: "…",
                                sessionStateLabel = when (sessionState) {
                                    NovaRepository.SessionState.READY -> "connecté"
                                    NovaRepository.SessionState.CONNECTING -> "connexion…"
                                    NovaRepository.SessionState.UNAUTHENTICATED -> "clé refusée"
                                    NovaRepository.SessionState.UNREACHABLE -> "injoignable"
                                    NovaRepository.SessionState.NOT_CONFIGURED -> ""
                                },
                                qrCode = if (displayedBotIsDefault) qrCode else null,
                                onToggleConnect = { viewModel.toggleConnect() },
                                onOpenBots = { viewModel.setActiveTab(NavTab.BOTS) },
                                onDiagnose = { showDiagnosticsDialog = true },
                                onRefresh = { viewModel.runDiagnostic() },
                                onAbout = { showAboutDialog = true }
                            )
                        }

                        NavTab.BOTS -> {
                            BotsScreen(
                                bots = bots,
                                selectedBotId = selectedBotId,
                                onSelectBot = { viewModel.selectBot(it) },
                                onStartBot = { viewModel.botAction(it, "start") },
                                onStopBot = { viewModel.botAction(it, "stop") },
                                onRestartBot = { viewModel.botAction(it, "restart") }
                            )
                        }

                        NavTab.SETTINGS -> {
                            SettingsScreen(
                                versionLabel = "v0.1.0",
                                updating = systemInfo.updating,
                                onSaveConnection = { url, token ->
                                    NovaSession.url = url
                                    NovaSession.token = token
                                    NovaRepository.reconfigure(url, token)
                                },
                                onSystemUpdate = { viewModel.systemAction("update") },
                                onSystemRestart = { viewModel.systemAction("restart") },
                                onSystemStop = { viewModel.systemAction("stop") },
                                onLogout = { viewModel.logout() }
                            )
                        }
                    }
                }
            }
        }

        // Diagnostic réseau — mesures RÉELLES (latence fraîche vers le panneau)
        if (showDiagnosticsDialog) {
            AlertDialog(
                onDismissRequest = { showDiagnosticsDialog = false },
                containerColor = DarkSurface,
                shape = RoundedCornerShape(20.dp),
                icon = {
                    Box(contentAlignment = Alignment.Center) {
                        SwiftSlateSpinner(
                            size = 36.dp,
                            tint = CyanNeon,
                            speedMs = 1000
                        )
                    }
                },
                title = {
                    Text(
                        text = "Diagnostic réseau",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )
                },
                text = {
                    Column(modifier = Modifier.padding(top = 4.dp)) {
                        Text(
                            text = "Mesure fraîche vers le panneau :",
                            style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
                        )
                        Spacer(modifier = Modifier.height(12.dp))

                        val latency = diagLatency
                        DiagnosticResultRow(
                            label = "Latence",
                            value = latency?.let { "$it ms" } ?: "en cours…",
                            color = if (latency == null) TextSecondary else {
                                if (latency < 150) MintGreen else Color(0xFFFBBF24)
                            }
                        )
                        DiagnosticResultRow(
                            label = "Gigue (dernier poll)",
                            value = "${telemetry.jitterMs} ms",
                            color = MintGreen
                        )
                        DiagnosticResultRow(
                            label = "Panneau",
                            value = when (sessionState) {
                                NovaRepository.SessionState.READY -> "Joignable • authentifié"
                                NovaRepository.SessionState.CONNECTING -> "Connexion…"
                                NovaRepository.SessionState.UNAUTHENTICATED -> "Clé refusée (401)"
                                NovaRepository.SessionState.UNREACHABLE -> "Injoignable"
                                NovaRepository.SessionState.NOT_CONFIGURED -> ""
                            },
                            color = CyanNeon
                        )
                        DiagnosticResultRow(
                            label = "Commit",
                            value = systemInfo.commit?.take(7) ?: "n/d",
                            color = CyanNeon
                        )
                    }
                },
                confirmButton = {
                    Button(
                        onClick = { showDiagnosticsDialog = false },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = CyanNeon,
                            contentColor = DarkBackground
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Fermer", fontWeight = FontWeight.Bold)
                    }
                }
            )
        }

        // À propos
        if (showAboutDialog) {
            AlertDialog(
                onDismissRequest = { showAboutDialog = false },
                containerColor = DarkSurface,
                shape = RoundedCornerShape(20.dp),
                icon = {
                    SlateMark(size = 40.dp, tint = CyanNeon)
                },
                title = {
                    Text(
                        text = "NOVA",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    )
                },
                text = {
                    Column {
                        Text(
                            text = "Panneau de contrôle Android du bot Nebula",
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontWeight = FontWeight.SemiBold,
                                color = TextPrimary
                            )
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Interface Material 3 et animations SwiftSlate conçues par le propriétaire. NOVA se connecte directement à l'API du panneau avec ta clé (Bearer) — aucune donnée ne transite ailleurs.",
                            style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Text(
                            text = "Version 0.1.0 • mono-repo android/",
                            style = MaterialTheme.typography.labelSmall.copy(color = MintGreen)
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showAboutDialog = false }) {
                        Text("Fermer", color = CyanNeon)
                    }
                }
            )
        }
    }
}

@Composable
private fun DiagnosticResultRow(label: String, value: String, color: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium.copy(
                fontWeight = FontWeight.SemiBold,
                color = color
            )
        )
    }
}
