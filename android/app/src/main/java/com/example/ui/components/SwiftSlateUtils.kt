package com.example.ui.components

import android.view.SoundEffectConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.EaseOutQuad
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkSurfaceVariant
import kotlinx.coroutines.delay

/**
 * Restrained press-feedback click modifier directly from SwiftSlate.
 * Scales down slightly when pressed and springs back when released, with haptics.
 */
@Composable
fun Modifier.bounceClick(onClick: () -> Unit = {}): Modifier {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val motion = LocalSlateMotion.current
    val haptic = LocalHapticFeedback.current
    val view = LocalView.current
    val scale by animateFloatAsState(
        targetValue = if (isPressed && !motion.reduceMotion) 0.95f else 1f,
        animationSpec = motion.effectFloatSpec(),
        label = "press_scale"
    )
    return this
        .graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
        .clickable(
            interactionSource = interactionSource,
            indication = null,
            onClick = {
                try {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    view.playSoundEffect(SoundEffectConstants.CLICK)
                } catch (_: Exception) {}
                onClick()
            }
        )
}

/**
 * Staggered cascade entrance animation from SwiftSlate.
 * Delays entrance based on [index] to create an elegant cascade effect.
 */
@Composable
fun AnimateEntrance(
    index: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    val motion = LocalSlateMotion.current
    val visible = remember { mutableStateOf(false) }

    LaunchedEffect(Unit, motion.reduceMotion) {
        if (!motion.reduceMotion) delay((index * 40L).coerceAtMost(300L))
        visible.value = true
    }

    AnimatedVisibility(
        visible = visible.value,
        modifier = modifier,
        enter = if (motion.reduceMotion) {
            fadeIn(animationSpec = motion.transitionSpec(0))
        } else {
            fadeIn(animationSpec = tween(220, easing = EaseOutQuad)) +
                slideInVertically(animationSpec = tween(220, easing = EaseOutQuad)) { 16 } +
                scaleIn(initialScale = 0.96f, animationSpec = tween(220, easing = EaseOutQuad))
        },
        exit = fadeOut(animationSpec = motion.transitionSpec(120))
    ) {
        content()
    }
}

/**
 * SwiftSlate signature terminal glyph mark (`>_`).
 */
@Composable
fun SlateMark(
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    tint: Color = CyanNeon
) {
    Surface(
        modifier = modifier.size(size),
        shape = RoundedCornerShape(10.dp),
        color = DarkSurfaceVariant.copy(alpha = 0.9f),
        tonalElevation = 2.dp
    ) {
        Canvas(modifier = Modifier.fillMaxSize().padding(size * 0.22f)) {
            val canvasWidth = this.size.width
            val canvasHeight = this.size.height
            val centerY = canvasHeight / 2f
            val left = canvasWidth * 0.14f
            val elbow = canvasWidth * 0.42f
            val right = canvasWidth * 0.14f

            // Terminal prompt chevron `>`
            drawPath(
                path = Path().apply {
                    moveTo(left, centerY - canvasHeight * 0.26f)
                    lineTo(elbow, centerY)
                    lineTo(left, centerY + canvasHeight * 0.26f)
                },
                color = tint,
                style = Stroke(width = this.size.minDimension * 0.14f, cap = StrokeCap.Round)
            )

            // Terminal cursor line `_`
            drawLine(
                color = tint,
                start = Offset(elbow + right * 0.35f, centerY + canvasHeight * 0.26f),
                end = Offset(canvasWidth - right, centerY + canvasHeight * 0.26f),
                strokeWidth = this.size.minDimension * 0.14f,
                cap = StrokeCap.Round
            )
        }
    }
}
