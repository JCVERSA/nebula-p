package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkBackground
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.DarkSurfaceVariant
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.viewmodel.NovaViewModel

/**
 * NOVA — écran Télécommande (9.18xx).
 *
 * L'agent dans la poche : le texte tapé ici est exécuté par le moteur
 * EXACTEMENT comme si l'owner l'avait tapé sur WhatsApp (commande préfixée
 * → dispatch ; langage naturel → agent IA). Les réponses — liens, notes
 * vocales, écrans interactifs — arrivent dans le chat WhatsApp de l'owner,
 * le canal naturel. Nova confirme l'exécution et garde l'historique.
 *
 * Garde-fous côté serveur (30/h, ≤500 chars, commandes système exclues) ;
 * raccourcis chips pour les usages fréquents. Historique en mémoire
 * (session) — rien de persisté.
 */
private data class RemoteEntry(val text: String, val ok: Boolean, val message: String)

@Composable
fun RemoteScreen(viewModel: NovaViewModel) {
    val botStatus by viewModel.botStatus.collectAsState()
    var draft by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val history = remember { mutableStateListOf<RemoteEntry>() }
    val listState = rememberLazyListState()

    val shortcuts = listOf(".menu", ".a", ".ai", ".trad", ".w")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
            .imePadding(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // ── Carte titre ──────────────────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(DarkSurfaceCard)
                .border(1.dp, DarkCardBorder, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Text(
                text = "Télécommande",
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
            )
            Text(
                text = when (botStatus) {
                    com.example.model.BotStatus.CONNECTED ->
                        "Commande le bot comme si tu tapais sur WhatsApp — les réponses arrivent dans ton chat."
                    com.example.model.BotStatus.CONNECTING -> "Connexion en cours…"
                    else -> "Moteur hors ligne — les commandes seront refusées jusqu'au retour du bot."
                },
                style = MaterialTheme.typography.bodySmall.copy(color = TextMuted)
            )
        }

        // ── Raccourcis ───────────────────────────────────────────────────
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            shortcuts.forEach { sc ->
                Text(
                    text = sc,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = CyanNeon,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(DarkSurfaceVariant)
                        .border(1.dp, DarkCardBorder, RoundedCornerShape(8.dp))
                        .clickable { draft = sc }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                        .testTag("remote_shortcut_${sc.removePrefix(".")}")
                )
            }
        }

        // ── Historique ───────────────────────────────────────────────────
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(14.dp))
                .background(DarkBackground)
                .border(1.dp, DarkCardBorder, RoundedCornerShape(14.dp))
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (history.isEmpty()) {
                item {
                    Text(
                        text = "Aucune commande envoyée.\nEssaie « .menu », ou parle-lui naturellement : « télécharge l'épisode 5 de Mushoku Tensei ».",
                        fontSize = 11.sp,
                        lineHeight = 16.sp,
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 24.dp)
                    )
                }
            }
            items(history) { entry ->
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = "› ${entry.text}",
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = TextPrimary
                    )
                    Text(
                        text = (if (entry.ok) "✓ " else "✗ ") + entry.message,
                        fontSize = 10.sp,
                        lineHeight = 13.sp,
                        color = if (entry.ok) TextSecondary else TextMuted
                    )
                }
            }
        }

        // ── Champ + envoi ────────────────────────────────────────────────
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = { if (it.length <= 500) draft = it },
                placeholder = { Text("Commande ou message…", fontSize = 13.sp) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                modifier = Modifier
                    .weight(1f)
                    .testTag("remote_field"),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = CyanNeon,
                    unfocusedBorderColor = DarkCardBorder,
                    cursorColor = CyanNeon
                )
            )
            androidx.compose.material3.IconButton(
                onClick = {
                    val text = draft.trim()
                    if (text.isNotEmpty() && !sending) {
                        sending = true
                        viewModel.runRemoteCommand(text) { ok, message ->
                            history.add(RemoteEntry(text, ok, message))
                            sending = false
                        }
                        draft = ""
                    }
                },
                enabled = !sending && draft.isNotBlank(),
                modifier = Modifier.testTag("remote_send")
            ) {
                if (sending) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = CyanNeon
                    )
                } else {
                    Icon(
                        imageVector = Icons.Filled.Send,
                        contentDescription = "Envoyer",
                        tint = CyanNeon
                    )
                }
            }
        }
        Spacer(Modifier.height(4.dp))
    }
}
