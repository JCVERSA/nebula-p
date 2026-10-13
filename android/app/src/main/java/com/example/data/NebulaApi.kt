package com.example.data

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * API du panneau Nebula — les shapes collent aux routes réelles du dépôt
 * (src/panel/…) : champs nullables + valeurs par défaut partout, Moshi
 * ignore les champs inconnus et tolère les absents.
 */

data class HealthResponse(val status: String? = null)

data class BotStatusResponse(
    val status: String? = null,
    val qrCode: String? = null,
    val logs: List<String> = emptyList()
)

data class SystemInfoResponse(
    val version: String? = null,
    val commit: String? = null,
    val branch: String? = null,
    val buildCommit: String? = null,
    val processStale: Boolean = false,
    val uptimeSeconds: Long = 0,
    val updating: Boolean = false
)

data class WhatsAppStatusDto(val status: String? = null)

data class BotEntryDto(
    val id: String = "",
    val name: String = "",
    val enabled: Boolean = true,
    val running: Boolean? = null,
    val enginePort: Int = 0,
    val pid: Long? = null,
    val restarts: Long? = null,
    val whatsapp: WhatsAppStatusDto? = null,
    val isDefault: Boolean = false
)

data class BotsResponse(val bots: List<BotEntryDto> = emptyList())

data class CommandDto(val name: String = "", val category: String? = null)

data class UsersSummaryResponse(
    val total: Int = 0,
    val counts: UsersCountsDto? = null
)

data class UsersCountsDto(
    val all: Int = 0,
    val active7d: Int = 0,
    val new30d: Int = 0,
    val banned: Int = 0
)

data class LogsResponse(val lines: String = "")

data class ActionResultResponse(
    val started: Boolean = false,
    val success: Boolean = false,
    val ok: Boolean = false,
    val message: String? = null,
    val error: String? = null
) {
    /** Message lisible quel que soit le format de réponse du panneau. */
    fun bestMessage(): String = message ?: error ?: "OK"
    /** Succès, quel que soit le format ({started} action système / {success} bots / {ok}). */
    fun isSuccessful(): Boolean = started || success || ok
}

interface NebulaApi {
    @GET("api/health")
    suspend fun health(): HealthResponse

    @GET("api/bot/status")
    suspend fun botStatus(): BotStatusResponse

    @GET("api/system/info")
    suspend fun systemInfo(): SystemInfoResponse

    @GET("api/bots")
    suspend fun bots(): BotsResponse

    @GET("api/bot/commands")
    suspend fun commands(): List<CommandDto>

    @GET("api/bot/users")
    suspend fun users(): UsersSummaryResponse

    @GET("api/system/logs")
    suspend fun logs(@Query("lines") lines: Int = 80): LogsResponse

    @POST("api/bots/{id}/start")
    suspend fun startBot(@Path("id") id: String): ActionResultResponse

    @POST("api/bots/{id}/stop")
    suspend fun stopBot(@Path("id") id: String): ActionResultResponse

    @POST("api/bots/{id}/restart")
    suspend fun restartBot(@Path("id") id: String): ActionResultResponse

    @POST("api/system/update")
    suspend fun systemUpdate(): ActionResultResponse

    @POST("api/system/restart")
    suspend fun systemRestart(): ActionResultResponse

    @POST("api/system/stop")
    suspend fun systemStop(): ActionResultResponse
}

/** Construit l'API pour une URL + un token donnés (Bearer sur chaque requête). */
fun buildNebulaApi(baseUrl: String, token: String): NebulaApi {
    val cleanBase = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
    val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()
    return Retrofit.Builder()
        .baseUrl(cleanBase)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .client(
            okhttp3.OkHttpClient.Builder()
                .addInterceptor { chain ->
                    val request = chain.request().newBuilder()
                        .addHeader("Authorization", "Bearer $token")
                        .build()
                    chain.proceed(request)
                }
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
                .build()
        )
        .build()
        .create(NebulaApi::class.java)
}
