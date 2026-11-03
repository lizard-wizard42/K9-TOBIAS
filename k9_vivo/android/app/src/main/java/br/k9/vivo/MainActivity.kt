package br.k9.vivo

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.res.Configuration
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * K9 no celular = o MESMO painel do navegador (WebView em http://<IP do PC>:3080, pelo Wi-Fi), sem barra nativa.
 * O único controle de voz é o botão "Voz" do painel (seção Poses). Dentro do app ele usa o microfone nativo por uma ponte
 * de 6 métodos ([PonteVoz]); a decisão do que fazer com a frase (parar, regras locais, IA) é toda do painel.
 * Tudo chega ao PC pela rede Wi-Fi na porta 3080 (painel/hub; o Vivo vai pelo caminho /vivo do hub). Saiu da tela: o robô para, a escuta para, o Vivo fecha.
 */
class MainActivity : Activity(), TextToSpeech.OnInitListener {
    private val main = Handler(Looper.getMainLooper())
    private val http = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build()

    private var visivel = false
    @Volatile private var urlConfiavel = false          // a ponte só obedece enquanto a página atual é o painel local

    private var ws: WebSocket? = null                   // Vivo (IA), aberto só quando o painel pede
    private var vivoQuerArmado = false

    private var tts: TextToSpeech? = null
    private var ttsPronto = false
    private var falando = false
    private var reconhecedor: SpeechRecognizer? = null
    private var ouvindo = false
    private var quer = false                            // o botão Voz está ligado
    private var errosSeguidos = 0
    private var pendenteAposPermissao = false
    private var idiomaVoz: Locale = Locale.forLanguageTag("pt-BR")     // idioma escolhido no painel (reconhecimento e fala); só aceita a lista abaixo

    private lateinit var web: WebView
    private lateinit var erro: LinearLayout

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.parseColor("#0E1110")
        window.navigationBarColor = Color.parseColor("#0E1110")
        hostPc = prefs.getString("host", "") ?: ""
        intent?.getStringExtra("host")?.let { trocarHost(it) }          // adb: am start -e host 192.168.0.134 (só para configurar)
        montarTela()
        telaCheia()
    }

    private fun telaCheia() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.apply {
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(WindowInsets.Type.systemBars())
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) telaCheia()
    }

    // ---- tela: só o painel (e um aviso se ele não abrir) -----------------------------------------------
    @SuppressLint("SetJavaScriptEnabled")
    private fun montarTela() {
        val raiz = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#0E1110")) }
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0E1110"))
            settings.apply {
                javaScriptEnabled = true            // é o painel local; sem isso ele não existe
                domStorageEnabled = true            // localStorage do painel (tema, aleatório, voz)
                allowFileAccess = false; allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportMultipleWindows(false); builtInZoomControls = false
            }
            webViewClient = painelClient
            addJavascriptInterface(PonteVoz(), "K9App")      // só 6 métodos @JavascriptInterface (veja a classe)
        }
        erro = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.parseColor("#0E1110")); setPadding(dp(24), dp(24), dp(24), dp(24)); visibility = View.GONE
            addView(TextView(context).apply { text = getString(R.string.erro_titulo); setTextColor(Color.WHITE); textSize = 20f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER })
            addView(TextView(context).apply {
                text = getString(R.string.erro_detalhe)
                setTextColor(Color.parseColor("#9AABA3")); textSize = 15f; gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(16))
            })
            addView(Button(context).apply { text = getString(R.string.tentar_de_novo); setOnClickListener { carregarPainel() } })
            addView(Button(context).apply { text = getString(R.string.trocar_endereco); setOnClickListener { pedirEndereco() } })
        }
        raiz.addView(web, FrameLayout.LayoutParams(-1, -1)); raiz.addView(erro, FrameLayout.LayoutParams(-1, -1))
        setContentView(raiz)
        // Android 15+: o app desenha sob as barras do sistema; empurra o conteúdo para dentro delas.
        raiz.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION") v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    // só o painel local: qualquer outro endereço é bloqueado (nada de navegar para a internet por este app)
    private fun permitido(url: String): Boolean {
        val u = android.net.Uri.parse(url)
        return u.scheme == "http" && u.host == hostPc && hostValido(hostPc) && u.port == 3080
    }

    // Endereço do PC (hub) na rede local: guardado no app; só IP de rede privada (ou localhost), nunca a internet.
    private val prefs by lazy { getSharedPreferences("k9", MODE_PRIVATE) }
    private var hostPc: String = ""
    private fun hostValido(h: String): Boolean {
        if (h == "localhost" || h == "127.0.0.1") return true
        val p = h.split(".").map { it.toIntOrNull() ?: return false }
        if (p.size != 4 || p.any { it !in 0..255 }) return false
        return p[0] == 10 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && p[1] in 16..31)
    }
    private fun trocarHost(h: String): Boolean {
        val limpo = h.trim()
        if (!hostValido(limpo)) return false
        hostPc = limpo; prefs.edit().putString("host", limpo).apply(); return true
    }
    private fun pedirEndereco() {
        val campo = EditText(this).apply { setText(hostPc); hint = "192.168.0.134"; inputType = android.text.InputType.TYPE_CLASS_PHONE }
        AlertDialog.Builder(this).setTitle(getString(R.string.dialogo_endereco)).setView(campo).setCancelable(hostPc.isNotEmpty())
            .setPositiveButton(getString(R.string.salvar)) { _, _ ->
                if (trocarHost(campo.text.toString())) carregarPainel() else { Toast.makeText(this, getString(R.string.ip_invalido), Toast.LENGTH_LONG).show(); pedirEndereco() }
            }.show()
    }

    private val painelClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !permitido(request.url.toString())
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { urlConfiavel = permitido(url) }
        override fun onPageFinished(view: WebView, url: String) { urlConfiavel = permitido(url) }
        override fun onReceivedError(view: WebView, request: WebResourceRequest, e: WebResourceError) { if (request.isForMainFrame) mostrarErro() }
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, r: WebResourceResponse) { if (request.isForMainFrame) mostrarErro() }
    }

    private fun mostrarErro() { urlConfiavel = false; erro.visibility = View.VISIBLE }
    private fun carregarPainel() {
        if (hostPc.isEmpty()) { pedirEndereco(); return }
        erro.visibility = View.GONE; web.loadUrl("http://$hostPc:3080/")
    }
    private fun js(codigo: String) { web.evaluateJavascript(codigo, null) }
    private fun jsEstado(e: String) = js("window.K9VozEstado&&window.K9VozEstado(" + JSONObject.quote(e) + ")")

    // ---- ponte: o que a página do painel pode pedir ao app ---------------------------------------------
    // Nada de HTTP genérico, arquivos, permissões, tokens ou intents. Cada método checa que a página atual é o painel local.
    inner class PonteVoz {
        @JavascriptInterface fun ouvir(ligar: Boolean) { main.post { if (urlConfiavel) { if (ligar) ligarVoz() else desligarVoz("parado") } } }
        @JavascriptInterface fun idioma(tag: String) { main.post { if (urlConfiavel) definirIdioma(tag) } }
        @JavascriptInterface fun falar(texto: String) { main.post { if (urlConfiavel) falarTexto(texto.take(200)) } }
        @JavascriptInterface fun perguntarIA(texto: String) { main.post { if (urlConfiavel) { conectarVivo(); enviarVivo(JSONObject().put("type", "transcript").put("text", texto.take(300)).put("continuo", false)) } } }
        @JavascriptInterface fun armarVivo(armar: Boolean) { main.post { if (urlConfiavel) { vivoQuerArmado = armar; if (armar) conectarVivo(); enviarVivo(JSONObject().put("type", if (armar) "arm" else "disarm")) } } }
        @JavascriptInterface fun pararVivo() { main.post { if (urlConfiavel) { enviarVivo(JSONObject().put("type", "stop")); tts?.stop(); falando = false } } }
    }

    // Idiomas aceitos pela ponte (os mesmos do painel). Qualquer outra tag é ignorada.
    private val idiomasPermitidos = setOf("pt-BR", "en-US", "es-ES", "fr-FR", "de-DE", "zh-CN")
    private fun definirIdioma(tag: String) {
        if (tag !in idiomasPermitidos) return
        idiomaVoz = Locale.forLanguageTag(tag)
        if (ttsPronto) tts?.language = idiomaVoz
        if (quer) { reconhecedor?.cancel(); ouvindo = false; iniciarEscuta() }       // recomeça a escuta já no idioma novo
    }

    // ---- ciclo de vida: fora da tela nada fica ouvindo, andando nem armado -----------------------------
    override fun onStart() { super.onStart(); visivel = true; web.onResume(); if (web.url == null) carregarPainel() }

    override fun onStop() {
        visivel = false
        js("try{if(typeof K9Hub!=='undefined')K9Hub.stopAll();}catch(e){}")          // saiu do app: o robô para
        desligarVoz("parado"); tts?.stop(); falando = false
        ws?.close(1000, "saiu da tela"); ws = null; vivoQuerArmado = false
        web.onPause()
        super.onStop()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        js("try{if(typeof K9Hub!=='undefined')K9Hub.stopAll();}catch(e){}")
        web.requestLayout()
        telaCheia()
    }

    override fun onDestroy() { reconhecedor?.destroy(); reconhecedor = null; tts?.shutdown(); web.destroy(); super.onDestroy() }

    // ---- Vivo (IA) por WebSocket -----------------------------------------------------------------------
    private fun conectarVivo() {
        if (!visivel || ws != null) return
        ws = http.newWebSocket(Request.Builder().url("ws://$hostPc:3080/vivo").build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { main.post { if (ws === webSocket && vivoQuerArmado) enviarVivo(JSONObject().put("type", "arm")) } }
            override fun onMessage(webSocket: WebSocket, text: String) { main.post { if (ws === webSocket) receberVivo(text) } }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { main.post { vivoCaiu(webSocket) } }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { main.post { vivoCaiu(webSocket) } }
        })
    }

    private fun vivoCaiu(quem: WebSocket) {
        if (ws !== quem) return
        ws = null; js("window.K9VozVivo&&window.K9VozVivo(" + JSONObject.quote("{\"type\":\"state\",\"armed\":false,\"offline\":true}") + ")")
        if (visivel && vivoQuerArmado) main.postDelayed({ conectarVivo() }, 2000)
    }

    private fun enviarVivo(o: JSONObject) { ws?.send(o.toString()) }

    private fun receberVivo(texto: String) {
        val m = try { JSONObject(texto) } catch (e: Exception) { return }
        when (m.optString("type")) {
            "say" -> { falarTexto(m.optString("text")); js("window.K9VozResposta&&window.K9VozResposta(" + JSONObject.quote(m.optString("text")) + ")") }
            "state" -> js("window.K9VozVivo&&window.K9VozVivo(" + JSONObject.quote(texto) + ")")
        }
    }

    // ---- fala (TextToSpeech) ---------------------------------------------------------------------------
    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        tts?.language = idiomaVoz
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { main.post { falando = false; if (quer) iniciarEscuta() } }
            @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { falando = false; if (quer) iniciarEscuta() } }
        })
        ttsPronto = true
    }

    // O app NÃO fala (decisão do dono: sem voz de resposta no celular). As respostas aparecem só como texto no painel.
    @Suppress("UNUSED_PARAMETER")
    private fun falarTexto(texto: String) { /* mudo de propósito */ }

    // ---- escuta (SpeechRecognizer) ---------------------------------------------------------------------
    private fun ligarVoz() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendenteAposPermissao = true; requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1); return
        }
        quer = true; errosSeguidos = 0; iniciarEscuta()
    }

    private fun desligarVoz(estado: String) {
        val estava = quer || ouvindo
        quer = false; ouvindo = false; reconhecedor?.cancel()
        if (estava) jsEstado(estado)
    }

    override fun onRequestPermissionsResult(codigo: Int, permissoes: Array<out String>, resultados: IntArray) {
        val ok = codigo == 1 && resultados.firstOrNull() == PackageManager.PERMISSION_GRANTED
        if (ok && pendenteAposPermissao) { pendenteAposPermissao = false; ligarVoz() }
        else { pendenteAposPermissao = false; jsEstado("erro: sem permissão do microfone (libere nas configurações do app)") }
    }

    private fun iniciarEscuta() {
        if (ouvindo || falando || !visivel || !quer) return
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { desligarVoz("erro: este celular não tem reconhecimento de voz (app Google)"); return }
        if (reconhecedor == null) reconhecedor = SpeechRecognizer.createSpeechRecognizer(this).also { it.setRecognitionListener(escutador) }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, idiomaVoz.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        ouvindo = true; jsEstado("ouvindo")
        reconhecedor?.startListening(intent)
    }

    private val escutador = object : RecognitionListener {
        override fun onResults(r: Bundle?) {
            ouvindo = false
            val fala = r?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
            if (fala.isNotEmpty()) {
                errosSeguidos = 0
                android.util.Log.i("K9Voz", "ouvi=[$fala]")
                js("window.K9VozEntrada&&window.K9VozEntrada(" + JSONObject.quote(fala) + ",true)")
            }
            if (quer && !falando) main.postDelayed({ iniciarEscuta() }, 250)
        }
        override fun onError(erro: Int) {
            ouvindo = false
            when (erro) {
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> desligarVoz("erro: microfone sem permissão")
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {      // silêncio: normal; reabre sem barulho, e desiste se for só silêncio por muito tempo
                    if (quer && ++errosSeguidos >= 40) desligarVoz("parado: nada ouvido por uns 4 minutos")
                    else if (quer && !falando) main.postDelayed({ iniciarEscuta() }, 300)
                }
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> if (quer) main.postDelayed({ reconhecedor?.cancel(); iniciarEscuta() }, 600)
                else -> if (quer && !falando) { if (++errosSeguidos >= 10) desligarVoz("erro: reconhecimento de voz falhando (código $erro)") else main.postDelayed({ iniciarEscuta() }, 800) }
            }
        }
        override fun onReadyForSpeech(p: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(v: Float) {}
        override fun onBufferReceived(b: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(p: Bundle?) {}
        override fun onEvent(t: Int, p: Bundle?) {}
    }
}
