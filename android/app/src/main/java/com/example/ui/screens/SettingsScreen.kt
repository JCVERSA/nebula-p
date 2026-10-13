package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.PowerSettingsNew
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.NovaSession
import com.example.ui.components.bounceClick
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkBackground
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

/**
 * NOVA — Réglages : connexion au panneau (URL + clé), actions système
 * (mise à jour / redémarrage / arrêt — avec avertissements RÉELS sur les
 * conséquences), et informations sur l'app.
 */
@Composable
fun SettingsScreen(
    versionLabel: String,
    updating: Boolean,
    onSaveConnection: (url: String, token: String) -> Unit,
    onSystemUpdate: () -> Unit,
    onSystemRestart: () -> Unit,
    onSystemStop: () -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier
) {
    var url by remember { mutableStateOf(NovaSession.url) }
    var token by remember { mutableStateOf(NovaSession.token) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBackground)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .testTag("settings_screen_content")
    ) {
        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "Réglages",
            style = MaterialTheme.typography.headlineSmall.copy(
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
        )

        Spacer(modifier = Modifier.height(18.dp))

        // ── Connexion au panneau ────────────────────────────────────────
        SectionCard(
            title = "Connexion au panneau",
            subtitle = "URL du tunnel + clé d'accès (PANEL_TOKEN)"
        ) {
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("URL") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                colors = fieldColors(),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(10.dp))
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Clé (PANEL_TOKEN)") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                colors = fieldColors(),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(12.dp))
            SettingsActionRow(
                label = "Enregistrer et reconnecter",
                icon = Icons.Outlined.Dns,
                tint = MintGreen,
                onClick = { onSaveConnection(url.trim(), token.trim()) }
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // ── Système ─────────────────────────────────────────────────────
        SectionCard(
            title = "Système",
            subtitle = "Actions sur le VPS — le panneau s'arrête pendant la mise à jour (2-5 min), c'est normal."
        ) {
            SettingsActionRow(
                label = if (updating) "Mise à jour en cours…" else "Mettre à jour",
                icon = Icons.Outlined.SystemUpdate,
                tint = CyanNeon,
                onClick = onSystemUpdate
            )
            SettingsActionRow(
                label = "Redémarrer le panneau",
                icon = Icons.Outlined.RestartAlt,
                tint = CyanNeon,
                onClick = onSystemRestart
            )
            SettingsActionRow(
                label = "Arrêter (bot + panneau)",
                icon = Icons.Outlined.PowerSettingsNew,
                tint = Color(0xFFFF5252),
                onClick = onSystemStop
            )
            Text(
                text = "« Arrêter » coupe aussi le panneau : seule la commande nebula start sur le VPS pourra le relancer.",
                style = MaterialTheme.typography.labelSmall.copy(color = TextMuted),
                modifier = Modifier.padding(top = 8.dp, start = 4.dp)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // ── Session ─────────────────────────────────────────────────────
        SectionCard(
            title = "Session",
            subtitle = "Déconnecte l'appareil (la clé reste effaçable ici)"
        ) {
            SettingsActionRow(
                label = "Se déconnecter",
                icon = Icons.Outlined.Logout,
                tint = Color(0xFFFBBF24),
                onClick = onLogout
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // ── À propos ────────────────────────────────────────────────────
        SectionCard(
            title = "À propos",
            subtitle = null
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Outlined.CloudSync,
                    contentDescription = null,
                    tint = CyanNeon,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "NOVA",
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = versionLabel,
                    style = MaterialTheme.typography.labelMedium.copy(color = TextSecondary)
                )
            }
            Text(
                text = "Panneau de contrôle Android pour le bot Nebula. Interface et animations SwiftSlate par le propriétaire ; connexion directe à l'API du panneau (Bearer).",
                style = MaterialTheme.typography.bodySmall.copy(
                    color = TextSecondary,
                    lineHeight = 18.sp
                ),
                modifier = Modifier.padding(top = 8.dp)
            )
        }

        Spacer(modifier = Modifier.height(28.dp))
    }
}

@Composable
private fun SectionCard(
    title: String,
    subtitle: String?,
    content: @Composable () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(DarkSurfaceCard)
            .border(1.dp, DarkCardBorder, RoundedCornerShape(18.dp))
            .padding(16.dp)
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall.copy(
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )
        )
        subtitle?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary),
                modifier = Modifier.padding(top = 2.dp, bottom = 12.dp)
            )
        } ?: Spacer(modifier = Modifier.height(12.dp))
        content()
    }
}

@Composable
private fun SettingsActionRow(
    label: String,
    icon: ImageVector,
    tint: Color,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(12.dp))
            .bounceClick(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = tint,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium.copy(
                color = TextPrimary,
                fontWeight = FontWeight.Medium
            )
        )
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = CyanNeon,
    unfocusedBorderColor = DarkCardBorder,
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    cursorColor = CyanNeon,
    focusedLabelColor = CyanNeon,
    unfocusedLabelColor = TextSecondary
)
