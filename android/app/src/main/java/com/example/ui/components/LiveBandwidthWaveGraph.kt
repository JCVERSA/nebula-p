package com.example.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceCard
import com.example.ui.theme.ElectricBlue
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import kotlin.math.PI
import kotlin.math.sin

@Composable
fun LiveBandwidthWaveGraph(
    downloadSpeedMbps: Float,
    uploadSpeedMbps: Float,
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "wave_phase")
    val phase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 2f * PI.toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(2200, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "phase"
    )

    // Smooth amplitude interpolation based on live speed
    val targetAmplitude = (downloadSpeedMbps.coerceIn(5f, 100f) / 100f) * 26f
    val animatedAmplitude by animateFloatAsState(
        targetValue = targetAmplitude,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = 200f),
        label = "amplitude"
    )

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(DarkSurfaceCard)
            .border(1.dp, DarkCardBorder, RoundedCornerShape(18.dp))
            .padding(16.dp)
            .testTag("live_bandwidth_wave_graph")
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(CyanNeon.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.GraphicEq,
                            contentDescription = "Wave Stream",
                            tint = CyanNeon,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = "Activité en direct",
                            style = MaterialTheme.typography.titleSmall.copy(
                                fontWeight = FontWeight.SemiBold,
                                color = TextPrimary
                            )
                        )
                        Text(
                            text = "Latence et gigue du panneau (temps réel)",
                            style = MaterialTheme.typography.bodySmall.copy(
                                color = TextSecondary,
                                fontSize = 11.sp
                            )
                        )
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(MintGreen, CircleShape)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "LIVE",
                        style = MaterialTheme.typography.labelSmall.copy(
                            color = MintGreen,
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Canvas drawing real-time sine/Bézier wave
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(72.dp)
            ) {
                val width = size.width
                val height = size.height
                val midY = height / 2f

                // Draw subtle grid lines
                val gridColor = DarkCardBorder.copy(alpha = 0.5f)
                drawLine(
                    color = gridColor,
                    start = Offset(0f, midY),
                    end = Offset(width, midY),
                    strokeWidth = 1.dp.toPx()
                )
                drawLine(
                    color = gridColor.copy(alpha = 0.3f),
                    start = Offset(0f, midY - 20.dp.toPx()),
                    end = Offset(width, midY - 20.dp.toPx()),
                    strokeWidth = 0.8.dp.toPx()
                )
                drawLine(
                    color = gridColor.copy(alpha = 0.3f),
                    start = Offset(0f, midY + 20.dp.toPx()),
                    end = Offset(width, midY + 20.dp.toPx()),
                    strokeWidth = 0.8.dp.toPx()
                )

                // Secondary Background Wave (Electric Blue)
                val bgPath = Path()
                val bgPoints = 60
                val bgStep = width / bgPoints
                bgPath.moveTo(0f, midY)

                for (i in 0..bgPoints) {
                    val x = i * bgStep
                    val angle = (x / width) * 4f * PI.toFloat() - (phase * 0.75f)
                    val y = midY + sin(angle) * (animatedAmplitude * 0.65f)
                    if (i == 0) bgPath.moveTo(x, y) else bgPath.lineTo(x, y)
                }

                drawPath(
                    path = bgPath,
                    color = ElectricBlue.copy(alpha = 0.45f),
                    style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
                )

                // Primary Wave (Cyan Neon with gradient fill)
                val wavePath = Path()
                val fillPath = Path()
                val points = 80
                val step = width / points

                wavePath.moveTo(0f, midY)
                fillPath.moveTo(0f, height)

                for (i in 0..points) {
                    val x = i * step
                    val angle = (x / width) * 3f * PI.toFloat() + phase
                    val harmonic = sin(angle * 2f + phase * 0.5f) * (animatedAmplitude * 0.25f)
                    val y = midY + sin(angle) * animatedAmplitude + harmonic
                    if (i == 0) {
                        wavePath.moveTo(x, y)
                        fillPath.lineTo(x, y)
                    } else {
                        wavePath.lineTo(x, y)
                        fillPath.lineTo(x, y)
                    }
                }

                fillPath.lineTo(width, height)
                fillPath.close()

                // Gradient fill underneath wave
                drawPath(
                    path = fillPath,
                    brush = Brush.verticalGradient(
                        colors = listOf(
                            CyanNeon.copy(alpha = 0.25f),
                            CyanNeon.copy(alpha = 0.02f)
                        ),
                        startY = midY - animatedAmplitude,
                        endY = height
                    )
                )

                // Glowing wave stroke line
                drawPath(
                    path = wavePath,
                    brush = Brush.horizontalGradient(
                        colors = listOf(ElectricBlue, CyanNeon, MintGreen)
                    ),
                    style = Stroke(width = 2.8.dp.toPx(), cap = StrokeCap.Round)
                )
            }
        }
    }
}
