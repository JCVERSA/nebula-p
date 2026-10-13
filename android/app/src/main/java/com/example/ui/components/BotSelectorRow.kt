package com.example.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.BotSelection
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurfaceVariant
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

@Composable
fun BotSelectorRow(
    selection: BotSelection,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val motion = LocalSlateMotion.current

    Box(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp)
            .testTag("bot_selector_row")
            .clip(RoundedCornerShape(16.dp))
            .background(DarkSurfaceVariant.copy(alpha = 0.6f))
            .border(1.dp, DarkCardBorder.copy(alpha = 0.8f), RoundedCornerShape(16.dp))
            .bounceClick(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                // Flag emoji
                Text(
                    text = selection.emoji,
                    fontSize = 22.sp,
                    modifier = Modifier.padding(end = 12.dp)
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = selection.name,
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary,
                            fontSize = 15.sp
                        )
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = selection.subtitle,
                        style = MaterialTheme.typography.bodySmall.copy(
                            color = TextSecondary,
                            fontSize = 13.sp
                        )
                    )
                }
            }

            // Latency ping badge with SwiftSlate spinner and morphing dropdown indicator
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                val pingColor = when {
                    selection.latencyMs < 40 -> MintGreen
                    selection.latencyMs < 90 -> Color(0xFFFBBF24)
                    else -> Color(0xFFFF5252)
                }

                // Signature SwiftSlate quadrant spinner as latency badge indicator
                SwiftSlateSpinner(
                    size = 14.dp,
                    tint = pingColor,
                    speedMs = 1400
                )

                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "${selection.latencyMs} ms",
                    style = MaterialTheme.typography.labelMedium.copy(
                        color = pingColor,
                        fontWeight = FontWeight.SemiBold
                    )
                )
                Spacer(modifier = Modifier.width(8.dp))
                SlateMorphIcon(
                    type = SlateMorphIconType.ExpandCollapse,
                    toggled = false,
                    modifier = Modifier.size(18.dp),
                    tint = TextSecondary,
                    contentDescription = "Choisir le bot"
                )
            }
        }
    }
}
