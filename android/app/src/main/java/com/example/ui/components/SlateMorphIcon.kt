package com.example.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Geometric icon morph types adapted directly from SwiftSlate motion design.
 */
enum class SlateMorphIconType {
    MenuClose,
    EditCheck,
    AddCheck,
    LoadingSuccess,
    ExpandCollapse
}

/**
 * Draws icon pairs as a continuous geometric transition without external heavy runtimes.
 * Adapted from SwiftSlate (com.jcversa.swiftslate.ui.components.SlateMorphIcon).
 */
@Composable
fun SlateMorphIcon(
    type: SlateMorphIconType,
    toggled: Boolean,
    modifier: Modifier = Modifier,
    tint: Color,
    contentDescription: String? = null
) {
    val motion = LocalSlateMotion.current
    val progress by animateFloatAsState(
        targetValue = if (toggled) 1f else 0f,
        animationSpec = motion.spatialFloatSpec(),
        label = "${type.name.lowercase()}_morph"
    )

    val semanticsModifier = if (contentDescription == null) {
        Modifier
    } else {
        Modifier.semantics { this.contentDescription = contentDescription }
    }

    Canvas(modifier = modifier.then(semanticsModifier)) {
        val stroke = (size.minDimension * 0.095f).coerceAtLeast(1.5.dp.toPx())
        when (type) {
            SlateMorphIconType.MenuClose -> drawMenuClose(progress, tint, stroke)
            SlateMorphIconType.EditCheck -> drawEditCheck(progress, tint, stroke)
            SlateMorphIconType.AddCheck -> drawAddCheck(progress, tint, stroke)
            SlateMorphIconType.LoadingSuccess -> drawLoadingSuccess(progress, tint, stroke)
            SlateMorphIconType.ExpandCollapse -> drawExpandCollapse(progress, tint, stroke)
        }
    }
}

private fun DrawScope.drawMenuClose(
    progress: Float,
    color: Color,
    stroke: Float
) {
    val left = size.width * 0.20f
    val right = size.width * 0.80f
    val top = size.height * 0.31f
    val middle = size.height * 0.50f
    val bottom = size.height * 0.69f
    val center = Offset(size.width * 0.50f, size.height * 0.50f)

    drawLine(
        color = color,
        start = lerp(Offset(left, top), Offset(left, top), progress),
        end = lerp(Offset(right, top), Offset(right, bottom), progress),
        strokeWidth = stroke,
        cap = StrokeCap.Round
    )
    drawLine(
        color = color.copy(alpha = (1f - progress).coerceIn(0f, 1f)),
        start = Offset(left, middle),
        end = lerp(Offset(right, middle), center, progress),
        strokeWidth = stroke,
        cap = StrokeCap.Round
    )
    drawLine(
        color = color,
        start = lerp(Offset(left, bottom), Offset(left, bottom), progress),
        end = lerp(Offset(right, bottom), Offset(right, top), progress),
        strokeWidth = stroke,
        cap = StrokeCap.Round
    )
}

private fun DrawScope.drawEditCheck(
    progress: Float,
    color: Color,
    stroke: Float
) {
    val pencilStart = Offset(size.width * 0.24f, size.height * 0.72f)
    val pencilEnd = Offset(size.width * 0.75f, size.height * 0.27f)
    val checkStart = Offset(size.width * 0.20f, size.height * 0.53f)
    val checkMiddle = Offset(size.width * 0.42f, size.height * 0.74f)
    val checkEnd = Offset(size.width * 0.80f, size.height * 0.29f)

    val path = Path().apply {
        moveTo(lerp(pencilStart, checkStart, progress).x, lerp(pencilStart, checkStart, progress).y)
        lineTo(lerp(pencilEnd, checkMiddle, progress).x, lerp(pencilEnd, checkMiddle, progress).y)
        lineTo(
            lerp(pencilEnd + Offset(0f, -size.height * 0.16f), checkEnd, progress).x,
            lerp(pencilEnd + Offset(0f, -size.height * 0.16f), checkEnd, progress).y
        )
    }
    drawPath(
        path = path,
        color = color,
        style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round)
    )

    if (progress < 0.55f) {
        drawLine(
            color = color.copy(alpha = (1f - progress * 1.8f).coerceIn(0f, 1f)),
            start = Offset(size.width * 0.20f, size.height * 0.76f),
            end = lerp(Offset(size.width * 0.30f, size.height * 0.83f), checkStart, progress),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
    }
}

private fun DrawScope.drawAddCheck(
    progress: Float,
    color: Color,
    stroke: Float
) {
    val plusHorizontalStart = Offset(size.width * 0.22f, size.height * 0.50f)
    val plusHorizontalEnd = Offset(size.width * 0.78f, size.height * 0.50f)
    val plusVerticalStart = Offset(size.width * 0.50f, size.height * 0.22f)
    val plusVerticalEnd = Offset(size.width * 0.50f, size.height * 0.78f)
    val checkStart = Offset(size.width * 0.20f, size.height * 0.52f)
    val checkMiddle = Offset(size.width * 0.43f, size.height * 0.73f)
    val checkEnd = Offset(size.width * 0.80f, size.height * 0.29f)

    drawLine(
        color = color,
        start = lerp(plusHorizontalStart, checkStart, progress),
        end = lerp(plusHorizontalEnd, checkMiddle, progress),
        strokeWidth = stroke,
        cap = StrokeCap.Round
    )
    drawLine(
        color = color,
        start = lerp(plusVerticalStart, checkMiddle, progress),
        end = lerp(plusVerticalEnd, checkEnd, progress),
        strokeWidth = stroke,
        cap = StrokeCap.Round
    )
}

private fun DrawScope.drawLoadingSuccess(
    progress: Float,
    color: Color,
    stroke: Float
) {
    val inset = size.minDimension * 0.18f
    drawArc(
        color = color.copy(alpha = (1f - progress).coerceIn(0f, 1f)),
        startAngle = -90f,
        sweepAngle = 300f * (1f - progress),
        useCenter = false,
        topLeft = Offset(inset, inset),
        size = Size(size.width - inset * 2f, size.height - inset * 2f),
        style = Stroke(width = stroke, cap = StrokeCap.Round)
    )

    val start = Offset(size.width * 0.20f, size.height * 0.52f)
    val middle = Offset(size.width * 0.43f, size.height * 0.73f)
    val end = Offset(size.width * 0.81f, size.height * 0.30f)
    val path = Path().apply {
        moveTo(lerp(start, start, progress).x, lerp(start, start, progress).y)
        lineTo(lerp(start, middle, progress).x, lerp(start, middle, progress).y)
        lineTo(lerp(start, end, progress).x, lerp(start, end, progress).y)
    }
    drawPath(
        path = path,
        color = color.copy(alpha = progress.coerceIn(0f, 1f)),
        style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round)
    )
}

private fun DrawScope.drawExpandCollapse(
    progress: Float,
    color: Color,
    stroke: Float
) {
    val center = Offset(size.width * 0.50f, size.height * 0.50f)
    val left = Offset(size.width * 0.25f, size.height * 0.42f)
    val right = Offset(size.width * 0.75f, size.height * 0.42f)
    val leftTarget = Offset(size.width * 0.25f, size.height * 0.58f)
    val rightTarget = Offset(size.width * 0.75f, size.height * 0.58f)

    drawLine(color, left, lerp(center, leftTarget, progress), stroke, StrokeCap.Round)
    drawLine(color, right, lerp(center, rightTarget, progress), stroke, StrokeCap.Round)
}

private fun lerp(start: Offset, end: Offset, fraction: Float): Offset =
    Offset(
        start.x + (end.x - start.x) * fraction,
        start.y + (end.y - start.y) * fraction
    )
