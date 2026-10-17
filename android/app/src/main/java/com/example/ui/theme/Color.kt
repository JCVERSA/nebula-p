package com.example.ui.theme

import androidx.compose.ui.graphics.Color

// Nova Dark Theme Color Tokens
// 9.18vv (décision owner 16/10, audit design D8) : unification de NOVA sur
// l'identité du panel web — noir + ambre (avant : bleu-nuit + cyan néon de
// thisui). Les composants et animations SwiftSlate sont INTACTS, seules les
// valeurs de tokens changent. Ramp calée sur le panel : #0b0b0c (page),
// #0e0e11 (cartes), #18181b (surélevé), zinc pour les textes, ambre 500 en
// accent — la couleur de la bulle, des boutons et des morphs du dashboard.
val DarkBackground = Color(0xFF0B0B0C)
val DarkSurface = Color(0xFF0E0E11)
val DarkSurfaceVariant = Color(0xFF18181B)
val DarkSurfaceCard = Color(0xFF141416)
val DarkCardBorder = Color(0xFF26262B)

val CyanNeon = Color(0xFFF59E0B) // devenu AMBRE (nom conservé : 8 fichiers y réfèrent)
val CyanGlow = Color(0x33F59E0B) // halo ambre 20 %
val BlueAccent = Color(0xFFFBBF24) // ambre 400 — actions secondaires
val ElectricBlue = Color(0xFFFCD34D) // ambre 300 — accents doux

val MintGreen = Color(0xFF34D399) // succès : emerald du panel web
val MintGlow = Color(0x3334D399)
val CoralRed = Color(0xFFFB7185) // erreurs : rose du panel web
val AmberWarning = Color(0xFFFBBF24)

val TextPrimary = Color(0xFFF8FAFC)
val TextSecondary = Color(0xFFA1A1AA) // zinc-400, comme le panel
val TextMuted = Color(0xFF71717A) // zinc-500, comme le panel

val SquircleBorderDefault = Color(0xFFE2E8F0)
val SquircleBorderActive = Color(0xFFF59E0B) // ambre — le bouton connect devient ambre
val SquircleBg = Color(0xFF0E0E11)
