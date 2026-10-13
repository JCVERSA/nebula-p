package com.example.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Timer
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
import com.example.model.BotStatus
import com.example.model.BotTelemetry
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

/**
 * Télémétrie du déploiement (transplant honnête des cartes VPN) :
 * uptime du panneau, latence mesurée, commandes enregistrées, utilisateurs
 * connus + wave latence/gigue en direct. Toutes les valeurs sont réelles.
 */
@Composable
fun TelemetryCards(
    status: BotStatus,
    telemetry: BotTelemetry,
    modifier: Modifier = Modifier
) {
    val animatedLatency by animateIntAsState(
        targetValue = telemetry.latencyMs,
        animationSpec = spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow),
        label = "animated_latency"
    )

    val animatedCommands by animateIntAsState(
        targetValue = telemetry.commandsTotal,
        animationSpec = spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow),
        label = "animated_commands"
    )

    val animatedUsers by animateIntAsState(
        targetValue = telemetry.usersTotal,
        animationSpec = spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow),
        label = "animated_users"
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag("telemetry_dashboard_section")
    ) {
        // Wave en direct : latence (courbe principale) et gigue (courbe secondaire)
        LiveBandwidthWaveGraph(
            downloadSpeedMbps = telemetry.latencyMs.toFloat().coerceAtLeast(5f),
            uploadSpeedMbps = telemetry.jitterMs.toFloat().coerceAtLeast(5f),
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(14.dp))

        // Rangée 1 : uptime du panneau + latence réseau
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            InteractiveMetricCard(modifier = Modifier.weight(1f)) {
                MetricIconBox(tint = MintGreen) {
                    Icon(
                        imageVector = Icons.Outlined.Timer,
                        contentDescription = "Uptime",
                        tint = MintGreen,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                MetricTexts(label = "Panneau up", value = telemetry.formattedUptime())
            }

            InteractiveMetricCard(modifier = Modifier.weight(1f)) {
                MetricIconBox(tint = CyanNeon) {
                    Icon(
                        imageVector = Icons.Outlined.Speed,
                        contentDescription = "Latence",
                        tint = CyanNeon,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                MetricTexts(label = "Latence", value = "$animatedLatency ms")
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Rangée 2 : commandes enregistrées + utilisateurs connus
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            InteractiveMetricCard(modifier = Modifier.weight(1f)) {
                MetricIconBox(tint = CyanNeon) {
                    Icon(
                        imageVector = Icons.Outlined.Terminal,
                        contentDescription = "Commandes",
                        tint = CyanNeon,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                MetricTexts(label = "Commandes", value = "$animatedCommands")
            }

            InteractiveMetricCard(modifier = Modifier.weight(1f)) {
                MetricIconBox(tint = MintGreen) {
                    Icon(
                        imageVector = Icons.Outlined.People,
                        contentDescription = "Utilisateurs",
                        tint = MintGreen,
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                MetricTexts(label = "Utilisateurs", value = "$animatedUsers")
            }
        }
    }
}

@Composable
private fun MetricIconBox(
    tint: Color,
    content: @Composable () -> Unit
) {
    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(tint.copy(alpha = 0.15f)),
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

@Composable
private fun MetricTexts(label: String, value: String) {
    Column {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(color = TextSecondary)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium.copy(
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
        )
    }
}

@Composable
private fun InteractiveMetricCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Box(
        modifier = modifier
            .testTag("interactive_metric_card")
            .clip(RoundedCornerShape(16.dp))
            .background(DarkSurfaceCard)
            .bounceClick(onClick = {})
            .padding(horizontal = 14.dp, vertical = 14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            content()
        }
    }
}
