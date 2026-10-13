package com.example.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceVariant
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextMuted

/**
 * Fluid, physics-based toggle switch with spring thumb travel,
 * dynamic stretching on drag/toggle, and glowing neon track expansion.
 */
@Composable
fun SwiftSlateToggle(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    activeColor: Color = CyanNeon,
    testTag: String = "swiftslate_toggle"
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()

    // Spring position for thumb travel (0.dp to 24.dp)
    val thumbOffset by animateDpAsState(
        targetValue = if (checked) 24.dp else 0.dp,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "toggle_thumb_offset"
    )

    // Dynamic width expansion: thumb stretches when pressed or toggling
    val thumbWidth by animateDpAsState(
        targetValue = if (isPressed) 26.dp else 20.dp,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 400f),
        label = "toggle_thumb_width"
    )

    // Track background color transition
    val trackBgColor by animateColorAsState(
        targetValue = if (checked) activeColor.copy(alpha = 0.25f) else DarkSurfaceVariant,
        animationSpec = tween(300),
        label = "toggle_track_bg"
    )

    // Track border color transition
    val trackBorderColor by animateColorAsState(
        targetValue = if (checked) activeColor.copy(alpha = 0.7f) else DarkCardBorder,
        animationSpec = tween(300),
        label = "toggle_track_border"
    )

    // Thumb color transition
    val thumbColor by animateColorAsState(
        targetValue = if (checked) activeColor else TextMuted,
        animationSpec = tween(250),
        label = "toggle_thumb_color"
    )

    Box(
        modifier = modifier
            .testTag(testTag)
            .width(52.dp)
            .height(28.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(trackBgColor)
            .border(1.2.dp, trackBorderColor, RoundedCornerShape(14.dp))
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = { onCheckedChange(!checked) }
            )
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.CenterStart
    ) {
        // Sliding & Stretching Thumb
        Box(
            modifier = Modifier
                .offset(x = thumbOffset)
                .size(width = thumbWidth, height = 20.dp)
                .shadow(elevation = if (checked) 4.dp else 1.dp, shape = CircleShape)
                .clip(CircleShape)
                .background(thumbColor)
        )
    }
}
