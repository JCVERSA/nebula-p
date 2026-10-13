package com.example.ui.screens

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.BotSelection
import com.example.model.BotStatus
import com.example.model.BotTelemetry
import com.example.ui.components.BotSelectorRow
import com.example.ui.components.SquircleConnectButton
import com.example.ui.components.StatusBadgeCard
import com.example.ui.components.TelemetryCards
import com.example.ui.components.TopHeaderBar
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkBackground
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

/**
 * NOVA — écran principal : statut WhatsApp du bot, squircle démarrer/arrêter,
 * QR d'appairage quand le bot est hors ligne, télémétrie RÉELLE du panneau.
 */
@Composable
fun HomeScreen(
    status: BotStatus,
    selection: BotSelection,
    telemetry: BotTelemetry,
    commitLabel: String,
    sessionStateLabel: String,
    qrCode: String?,
    onToggleConnect: () -> Unit,
    onOpenBots: () -> Unit,
    onDiagnose: () -> Unit,
    onRefresh: () -> Unit,
    onAbout: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBackground)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .testTag("home_screen_content"),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        TopHeaderBar(
            onDiagnose = onDiagnose,
            onResetStats = onRefresh,
            onAbout = onAbout,
            badgeText = commitLabel
        )

        Spacer(modifier = Modifier.height(14.dp))

        StatusBadgeCard(
            status = status,
            protocol = selection.name
        )

        Spacer(modifier = Modifier.height(14.dp))

        BotSelectorRow(
            selection = selection,
            onClick = onOpenBots
        )

        Spacer(modifier = Modifier.height(22.dp))

        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            SquircleConnectButton(
                status = status,
                onToggle = onToggleConnect
            )
        }

        Spacer(modifier = Modifier.height(18.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            val indicatorColor = when (status) {
                BotStatus.DISCONNECTED -> Color(0xFFFF5252)
                BotStatus.CONNECTING -> CyanNeon
                BotStatus.CONNECTED -> MintGreen
                BotStatus.DISCONNECTING -> Color(0xFFFBBF24)
            }
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(indicatorColor, CircleShape)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = when (status) {
                    BotStatus.DISCONNECTED -> "Le bot ne répond pas sur WhatsApp"
                    BotStatus.CONNECTING -> "Connexion de la session WhatsApp…"
                    BotStatus.CONNECTED -> "Bot en ligne • messages traités"
                    BotStatus.DISCONNECTING -> "Arrêt du moteur…"
                },
                style = MaterialTheme.typography.bodySmall.copy(
                    color = TextSecondary,
                    fontSize = 13.sp
                )
            )
        }

        // QR d'appairage — affiché uniquement quand le bot est hors ligne
        // ET que le panneau fournit un QR (aucun placeholder bidon).
        if (status == BotStatus.DISCONNECTED && !qrCode.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(20.dp))
            QrPairingCard(qrCode = qrCode)
        }

        Spacer(modifier = Modifier.height(24.dp))

        TelemetryCards(
            status = status,
            telemetry = telemetry
        )

        if (status == BotStatus.CONNECTED) {
            Spacer(modifier = Modifier.height(16.dp))
        }

        // État de session (connexion panneau) — rempli RÉEL : version,
        // commit, branche, build. Aucune valeur décorative.
        Spacer(modifier = Modifier.height(8.dp))
        DeploymentInfoCard(
            sessionStateLabel = sessionStateLabel,
            commitLabel = commitLabel
        )

        Spacer(modifier = Modifier.height(24.dp))
    }
}

/**
 * Carte QR : décode le data-URL/base64 renvoyé par /api/bot/status en
 * Bitmap (sans dépendance Coil) et l'affiche avec les instructions.
 */
@Composable
private fun QrPairingCard(qrCode: String, modifier: Modifier = Modifier) {
    val bitmap = remember(qrCode) {
        runCatching {
            val pure = qrCode.substringAfter(",", qrCode)
            val bytes = Base64.decode(pure, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }.getOrNull()
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag("qr_pairing_card")
            .clip(RoundedCornerShape(18.dp))
            .background(DarkSurfaceCard)
            .border(1.dp, CyanNeon.copy(alpha = 0.35f), RoundedCornerShape(18.dp))
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "Appairage WhatsApp",
            style = MaterialTheme.typography.titleSmall.copy(
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary
            )
        )
        Text(
            text = "WhatsApp → Appareils connectés → Appareil associé",
            style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary),
            modifier = Modifier.padding(top = 2.dp)
        )
        Spacer(modifier = Modifier.height(14.dp))
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "QR d'appairage WhatsApp",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .size(232.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White)
                    .padding(8.dp)
            )
        } else {
            // QR illisible : on l'affiche en clair plutôt que de mentir
            Text(
                text = "QR reçu dans un format illisible — utilise le dashboard web pour l'appairage.",
                style = MaterialTheme.typography.bodySmall.copy(color = Color(0xFFFBBF24)),
                modifier = Modifier.padding(horizontal = 8.dp)
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Le QR se régénère à chaque rafraîchissement (5 s).",
            style = MaterialTheme.typography.labelSmall.copy(color = TextMuted)
        )
    }
}

/** État du déploiement : version, commit, build, branche — tout est réel. */
@Composable
private fun DeploymentInfoCard(
    sessionStateLabel: String,
    commitLabel: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(DarkSurfaceCard.copy(alpha = 0.6f))
            .border(1.dp, DarkCardBorder.copy(alpha = 0.7f), RoundedCornerShape(16.dp))
            .padding(16.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Outlined.Security,
                contentDescription = null,
                tint = CyanNeon,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = "Déploiement",
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
            )
            Spacer(modifier = Modifier.weight(1f))
            Icon(
                imageVector = Icons.Outlined.Refresh,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(14.dp)
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = sessionStateLabel,
                style = MaterialTheme.typography.labelSmall.copy(color = TextSecondary)
            )
        }
        Spacer(modifier = Modifier.height(10.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "Commit",
                style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
            )
            Text(
                text = commitLabel,
                style = MaterialTheme.typography.labelMedium.copy(
                    color = CyanNeon,
                    fontWeight = FontWeight.SemiBold
                )
            )
        }
    }
}
