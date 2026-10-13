package com.example.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.BotStatus
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.MintGreen
import com.example.ui.theme.SquircleBg
import com.example.ui.theme.SquircleBorderDefault
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun SquircleConnectButton(
    status: BotStatus,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier
) {
    val motion = LocalSlateMotion.current

    // Corner radius morphing based on active state
    val cornerRadius by animateDpAsState(
        targetValue = when (status) {
            BotStatus.CONNECTED -> 48.dp
            BotStatus.CONNECTING -> 52.dp
            else -> 42.dp
        },
        animationSpec = spring(dampingRatio = 0.65f, stiffness = 300f),
        label = "corner_radius_morph"
    )

    val infiniteTransition = rememberInfiniteTransition(label = "pulse_and_orbit")

    // Breathing radial wave expansion (0f to 1f)
    val waveProgress by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2400, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "waveProgress"
    )

    // Orbit angle for dual particles (0 to 360 degrees)
    val orbitAngle by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(3800, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "orbitAngle"
    )

    val borderColor by animateColorAsState(
        targetValue = when (status) {
            BotStatus.DISCONNECTED -> SquircleBorderDefault
            BotStatus.CONNECTING -> CyanNeon
            BotStatus.CONNECTED -> MintGreen
            BotStatus.DISCONNECTING -> Color(0xFFFF5252)
        },
        animationSpec = tween(450),
        label = "border_color"
    )

    val buttonLabel = when (status) {
        BotStatus.DISCONNECTED -> "Démarrer"
        BotStatus.CONNECTING -> "Connexion…"
        BotStatus.CONNECTED -> "Arrêter"
        BotStatus.DISCONNECTING -> "Arrêt…"
    }

    Box(
        modifier = modifier
            .size(240.dp) // Outer container with padding for waves and dual-orbit particles
            .testTag("nova_toggle_button_container"),
        contentAlignment = Alignment.Center
    ) {
        // Outer Canvas for continuous radial waves & rotating dual-orbit particles
        Canvas(modifier = Modifier.size(240.dp)) {
            val centerOffset = Offset(size.width / 2f, size.height / 2f)
            val baseRadius = 88.dp.toPx()

            // 1. Continuous breathing radial waves when connecting or connected
            if (status == BotStatus.CONNECTING || status == BotStatus.CONNECTED) {
                val waveColor = if (status == BotStatus.CONNECTED) MintGreen else CyanNeon

                // Ring 1 (Inner expanding)
                val r1 = baseRadius + (waveProgress * 32.dp.toPx())
                val a1 = ((1f - waveProgress) * 0.45f).coerceIn(0f, 1f)
                drawCircle(
                    color = waveColor.copy(alpha = a1),
                    radius = r1,
                    center = centerOffset,
                    style = Stroke(width = 2.dp.toPx())
                )

                // Ring 2 (Outer trailing expanding)
                val p2 = (waveProgress + 0.5f) % 1f
                val r2 = baseRadius + (p2 * 32.dp.toPx())
                val a2 = ((1f - p2) * 0.35f).coerceIn(0f, 1f)
                drawCircle(
                    color = waveColor.copy(alpha = a2),
                    radius = r2,
                    center = centerOffset,
                    style = Stroke(width = 1.5.dp.toPx())
                )
            }

            // 2. Rotating Dual-Orbit Particle Ring
            if (status == BotStatus.CONNECTING || status == BotStatus.CONNECTED) {
                val orbitRadius = 104.dp.toPx()
                val rad1 = Math.toRadians(orbitAngle.toDouble())
                val rad2 = Math.toRadians((-orbitAngle * 1.35).toDouble())

                val p1 = Offset(
                    x = centerOffset.x + (orbitRadius * cos(rad1)).toFloat(),
                    y = centerOffset.y + (orbitRadius * sin(rad1)).toFloat()
                )
                val p2 = Offset(
                    x = centerOffset.x + (orbitRadius * cos(rad2)).toFloat(),
                    y = centerOffset.y + (orbitRadius * sin(rad2)).toFloat()
                )

                // Particle 1 (Cyan with glow)
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(CyanNeon, Color.Transparent),
                        center = p1,
                        radius = 12.dp.toPx()
                    ),
                    center = p1,
                    radius = 12.dp.toPx()
                )
                drawCircle(
                    color = Color.White,
                    center = p1,
                    radius = 3.5.dp.toPx()
                )

                // Particle 2 (Mint with glow)
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(MintGreen, Color.Transparent),
                        center = p2,
                        radius = 10.dp.toPx()
                    ),
                    center = p2,
                    radius = 10.dp.toPx()
                )
                drawCircle(
                    color = Color.White,
                    center = p2,
                    radius = 2.8.dp.toPx()
                )
            }
        }

        // Inner Core Squircle Button with tactile SwiftSlate bounceClick
        Box(
            modifier = Modifier
                .size(186.dp)
                .testTag("nova_toggle_button")
                .clip(RoundedCornerShape(cornerRadius))
                .background(SquircleBg)
                .border(
                    width = 2.5.dp,
                    color = borderColor,
                    shape = RoundedCornerShape(cornerRadius)
                )
                .bounceClick(onClick = onToggle),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(16.dp)
            ) {
                if (status == BotStatus.CONNECTING || status == BotStatus.DISCONNECTING) {
                    SwiftSlateSpinner(
                        size = 34.dp,
                        tint = if (status == BotStatus.CONNECTING) CyanNeon else Color(0xFFFF5252),
                        speedMs = 1000
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                } else if (status == BotStatus.CONNECTED) {
                    SlateMorphIcon(
                        type = SlateMorphIconType.LoadingSuccess,
                        toggled = true,
                        modifier = Modifier.size(32.dp),
                        tint = MintGreen,
                        contentDescription = "Connected"
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                }

                Text(
                    text = buttonLabel,
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 20.sp,
                        color = TextPrimary
                    )
                )

                if (status == BotStatus.CONNECTED) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Bot en ligne",
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = MintGreen.copy(alpha = 0.85f),
                            fontWeight = FontWeight.Medium
                        )
                    )
                } else if (status == BotStatus.DISCONNECTED) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Appuie pour démarrer le bot",
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = TextMuted
                        )
                    )
                }
            }
        }
    }
}
