package com.example.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.BotStatus
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

@Composable
fun StatusBadgeCard(
    status: BotStatus,
    protocol: String,
    modifier: Modifier = Modifier
) {
    val statusText = when (status) {
        BotStatus.DISCONNECTED -> "Bot hors ligne"
        BotStatus.CONNECTING -> "Connexion WhatsApp…"
        BotStatus.CONNECTED -> "En ligne • $protocol"
        BotStatus.DISCONNECTING -> "Arrêt en cours…"
    }

    val statusSubtext = when (status) {
        BotStatus.DISCONNECTED -> "Le moteur WhatsApp est arrêté"
        BotStatus.CONNECTING -> "Connexion de la session WhatsApp"
        BotStatus.CONNECTED -> "Moteur actif • messages traités"
        BotStatus.DISCONNECTING -> "Arrêt du moteur en cours"
    }

    val iconColor by animateColorAsState(
        targetValue = when (status) {
            BotStatus.DISCONNECTED -> TextMuted
            BotStatus.CONNECTING -> CyanNeon
            BotStatus.CONNECTED -> MintGreen
            BotStatus.DISCONNECTING -> Color(0xFFFF5252)
        },
        label = "shield_icon_color"
    )

    val borderColor by animateColorAsState(
        targetValue = when (status) {
            BotStatus.CONNECTED -> MintGreen.copy(alpha = 0.35f)
            BotStatus.CONNECTING -> CyanNeon.copy(alpha = 0.35f)
            else -> DarkCardBorder
        },
        label = "card_border_color"
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .testTag("status_badge_card")
            .clip(RoundedCornerShape(18.dp))
            .background(DarkSurfaceCard)
            .border(1.dp, borderColor, RoundedCornerShape(18.dp))
            .bounceClick(onClick = {})
            .padding(horizontal = 20.dp, vertical = 16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                modifier = Modifier.weight(1f)
            ) {
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = if (status == BotStatus.CONNECTED) MintGreen else TextPrimary
                    )
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = statusSubtext,
                    style = MaterialTheme.typography.bodySmall.copy(
                        color = TextSecondary
                    )
                )
            }

            // Subtle vertical divider matching the reference image layout
            Box(
                modifier = Modifier
                    .padding(horizontal = 16.dp)
                    .width(1.dp)
                    .height(34.dp)
                    .background(DarkCardBorder)
            )

            // Shield icon with tactile state
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.size(36.dp)
            ) {
                if (status == BotStatus.CONNECTED) {
                    Icon(
                        imageVector = Icons.Filled.Shield,
                        contentDescription = "Shield Active",
                        tint = iconColor,
                        modifier = Modifier.size(32.dp)
                    )
                } else {
                    Icon(
                        imageVector = Icons.Outlined.Shield,
                        contentDescription = "Shield Inactive",
                        tint = iconColor,
                        modifier = Modifier.size(30.dp)
                    )
                }
            }
        }
    }
}
