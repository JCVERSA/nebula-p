package com.example.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.MintGreen

/**
 * Signature SwiftSlate multi-phase quadrant spinner (◐ ◓ ◑ ◒).
 * Features rotating quadrant fill with smooth continuous sweep and glowing outer halo.
 */
@Composable
fun SwiftSlateSpinner(
    modifier: Modifier = Modifier,
    size: Dp = 24.dp,
    tint: Color = CyanNeon,
    speedMs: Int = 1100
) {
    val infiniteTransition = rememberInfiniteTransition(label = "swiftslate_spinner")

    // Continuous 360 degree rotation
    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(speedMs, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "spinner_rotation"
    )

    // Phase morphing for quadrant sweep (0 to 180 degrees)
    val sweepAngle by infiniteTransition.animateFloat(
        initialValue = 45f,
        targetValue = 180f,
        animationSpec = infiniteRepeatable(
            animation = tween(speedMs / 2, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "spinner_sweep"
    )

    Box(
        modifier = modifier.size(size),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.size(size)) {
            val canvasSize = this.size.minDimension
            val radius = canvasSize / 2f
            val centerOffset = Offset(radius, radius)

            // Outer subtle track ring
            drawCircle(
                color = tint.copy(alpha = 0.2f),
                radius = radius - 1.5.dp.toPx(),
                center = centerOffset,
                style = Stroke(width = 1.5.dp.toPx())
            )

            // SwiftSlate signature filled semi-circle / quadrant (◐)
            drawArc(
                brush = Brush.sweepGradient(
                    colors = listOf(
                        tint.copy(alpha = 0.1f),
                        tint,
                        MintGreen
                    )
                ),
                startAngle = rotation,
                sweepAngle = sweepAngle,
                useCenter = true,
                topLeft = Offset(1.5.dp.toPx(), 1.5.dp.toPx()),
                size = Size(canvasSize - 3.dp.toPx(), canvasSize - 3.dp.toPx())
            )

            // Radiant leading edge dot
            val dotRadius = radius * 0.85f
            val angleRad = Math.toRadians((rotation + sweepAngle).toDouble())
            val dotX = (radius + dotRadius * kotlin.math.cos(angleRad)).toFloat()
            val dotY = (radius + dotRadius * kotlin.math.sin(angleRad)).toFloat()

            drawCircle(
                color = Color.White,
                radius = 1.6.dp.toPx(),
                center = Offset(dotX, dotY)
            )
        }
    }
}
