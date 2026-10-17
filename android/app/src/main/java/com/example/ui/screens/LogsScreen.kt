package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.example.viewmodel.NovaViewModel
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkBackground
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.DarkSurfaceVariant
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import kotlinx.coroutines.delay

/**
 * NOVA — écran Journal (9.18ww).
 *
 * L'API /api/system/logs était câblée depuis 9.18h sans qu'aucun écran ne
 * l'affiche. Parité honnête avec le panneau web : 200 dernières lignes,
 * rafraîchissement 5 s SEULEMENT pendant que l'onglet est ouvert (batterie),
 * pause/reprise, copie intégrale, aucune donnée simulée — injoignable =
 * dernières lignes connues conservées, état dit tel quel.
 */
@Composable
fun LogsScreen(viewModel: NovaViewModel) {
    val logs by viewModel.logs.collectAsState()
    val paused by viewModel.logsPaused.collectAsState()
    val scroll = rememberScrollState()
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        viewModel.startLogsPolling()
        onDispose { viewModel.stopLogsPolling() }
    }

    // Suivi automatique de la fin du journal (sauf pendant la sélection manuelle)
    LaunchedEffect(logs, paused) {
        if (!paused && scroll.maxValue > 0) scroll.scrollTo(scroll.maxValue)
    }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1600)
            copied = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // ── Carte titre + actions ────────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(DarkSurfaceCard)
                .border(1.dp, DarkCardBorder, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Filled.Terminal,
                    contentDescription = null,
                    tint = CyanNeon,
                    modifier = Modifier.width(18.dp).height(18.dp)
                )
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(
                        text = "Journal en direct",
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary
                        )
                    )
                    Text(
                        text = "200 dernières lignes du panneau · rafraîchi toutes les 5 s",
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = TextMuted
                        )
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(
                    label = if (paused) "Reprendre" else "Pause",
                    icon = if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause,
                    testTag = "logs_pause",
                    onClick = { viewModel.setLogsPaused(!paused) }
                )
                PillButton(
                    label = if (copied) "Copié ✔" else "Copier",
                    icon = Icons.Filled.ContentCopy,
                    testTag = "logs_copy",
                    enabled = !logs.isNullOrBlank(),
                    onClick = {
                        logs?.let { clipboard.setText(AnnotatedString(it)) }
                        copied = true
                    }
                )
            }
        }

        // ── Boîte du journal ─────────────────────────────────────────────
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(14.dp))
                .background(DarkBackground)
                .border(1.dp, DarkCardBorder, RoundedCornerShape(14.dp))
                .verticalScroll(scroll)
                .padding(10.dp)
                .testTag("logs_box")
        ) {
            when {
                logs == null -> Text(
                    "Chargement du journal…",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = TextMuted
                )
                logs!!.isBlank() -> Text(
                    "Aucune ligne — journal vide ou panneau injoignable.",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = TextMuted
                )
                else -> SelectionContainer {
                    Text(
                        text = logs.orEmpty(),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                        color = TextSecondary
                    )
                }
            }
        }
    }
}

/** Petit bouton pilule réutilisable (pause/copier) — style dock Nova. */
@Composable
private fun PillButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    testTag: String,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) DarkSurfaceVariant else DarkSurfaceVariant.copy(alpha = 0.5f))
            .border(1.dp, DarkCardBorder, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .testTag(testTag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (enabled) CyanNeon else TextMuted,
            modifier = Modifier.width(14.dp).height(14.dp)
        )
        Text(
            text = label,
            fontSize = 11.sp,
            color = if (enabled) TextSecondary else TextMuted
        )
    }
}
