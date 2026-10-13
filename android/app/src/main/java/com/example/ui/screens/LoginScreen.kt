package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.NovaRepository
import com.example.data.NovaSession
import com.example.ui.components.SlateMark
import com.example.ui.components.SwiftSlateSpinner
import com.example.ui.theme.CyanNeon
import com.example.ui.theme.DarkBackground
import com.example.ui.theme.DarkCardBorder
import com.example.ui.theme.DarkSurface
import com.example.ui.theme.DarkSurfaceVariant
import com.example.ui.theme.MintGreen
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import kotlinx.coroutines.launch

/**
 * Porte d'entrée de NOVA : URL du panneau + PANEL_TOKEN.
 * Vérification RÉELLE (GET /api/health avec Bearer) avant sauvegarde —
 * aucun état « connecté » affiché sans preuve.
 */
@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    modifier: Modifier = Modifier
) {
    var url by remember { mutableStateOf(NovaSession.url.ifBlank { "https://" }) }
    var token by remember { mutableStateOf(NovaSession.token) }
    var error by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(DarkBackground)
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(64.dp))

        SlateMark(size = 56.dp, tint = CyanNeon)

        Spacer(modifier = Modifier.height(18.dp))

        Text(
            text = "NOVA",
            style = MaterialTheme.typography.headlineLarge.copy(
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            ),
            modifier = Modifier.testTag("login_title")
        )

        Spacer(modifier = Modifier.height(6.dp))

        Text(
            text = "Panneau de contrôle Nebula",
            style = MaterialTheme.typography.bodyMedium.copy(color = TextSecondary)
        )

        Spacer(modifier = Modifier.height(40.dp))

        OutlinedTextField(
            value = url,
            onValueChange = { url = it; error = null },
            label = { Text("URL du panneau") },
            placeholder = { Text("https://dash.example.com") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CyanNeon,
                unfocusedBorderColor = DarkCardBorder,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary,
                cursorColor = CyanNeon,
                focusedLabelColor = CyanNeon,
                unfocusedLabelColor = TextSecondary
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("login_url_field")
        )

        Spacer(modifier = Modifier.height(14.dp))

        OutlinedTextField(
            value = token,
            onValueChange = { token = it; error = null },
            label = { Text("Clé du panneau (PANEL_TOKEN)") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CyanNeon,
                unfocusedBorderColor = DarkCardBorder,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary,
                cursorColor = CyanNeon,
                focusedLabelColor = CyanNeon,
                unfocusedLabelColor = TextSecondary
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("login_token_field")
        )

        Spacer(modifier = Modifier.height(10.dp))

        Text(
            text = "La clé n'est jamais affichée. Elle est envoyée uniquement à ton panneau, en en-tête Bearer.",
            style = MaterialTheme.typography.labelSmall.copy(color = TextMuted),
            modifier = Modifier.padding(horizontal = 4.dp)
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(
            onClick = {
                if (url.isBlank() || token.isBlank()) {
                    error = "Renseigne l'URL et la clé du panneau."
                    return@Button
                }
                checking = true
                error = null
                scope.launch {
                    val result = NovaRepository.verify(url.trim(), token.trim())
                    checking = false
                    result.onSuccess {
                        NovaSession.url = url.trim()
                        NovaSession.token = token.trim()
                        NovaRepository.reconfigure(NovaSession.url, NovaSession.token)
                        onLoggedIn()
                    }.onFailure { e ->
                        error = e.message
                    }
                }
            },
            enabled = !checking,
            colors = ButtonDefaults.buttonColors(
                containerColor = CyanNeon,
                contentColor = DarkBackground
            ),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .testTag("login_submit")
        ) {
            if (checking) {
                SwiftSlateSpinner(size = 20.dp, tint = DarkBackground, speedMs = 900)
                Spacer(modifier = Modifier.width(10.dp))
                Text("Vérification…", fontWeight = FontWeight.Bold)
            } else {
                Text("Se connecter", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
        }

        error?.let { msg ->
            Spacer(modifier = Modifier.height(14.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0x33FF5252))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Text(
                    text = msg,
                    style = MaterialTheme.typography.bodySmall.copy(color = Color(0xFFFFB4AB)),
                    modifier = Modifier.testTag("login_error")
                )
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            text = "Astuce : la clé est celle de l'écran de connexion du dashboard web.",
            style = MaterialTheme.typography.labelSmall.copy(color = TextMuted)
        )

        Spacer(modifier = Modifier.height(32.dp))
    }
}
