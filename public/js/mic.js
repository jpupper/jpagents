// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  🎤 STANDALONE MICROPHONE MODULE — mic.js
//  Se carga ANTES de main.js para garantizar que el
//  micrófono funcione incluso si main.js falla.
//  Web Speech API (Chrome/Edge/Brave) — español (AR).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(function initStandaloneMic() {
    'use strict';

    // ── Esperar a que el DOM esté listo ──
    function whenReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    whenReady(() => {
        const micBtn = document.getElementById('mic-btn');
        const chatInput = document.getElementById('chat-input');
        if (!micBtn || !chatInput) {
            console.warn('[MIC-STANDALONE] No se encontraron mic-btn o chat-input — abortando.');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('[MIC-STANDALONE] Web Speech API no disponible en este navegador.');
            return;
        }

        // ── Toast inline (no depende de showToast de main.js) ──
        function toast(message, type, duration) {
            const existing = document.querySelector('.toast-notification');
            if (existing) existing.remove();
            const el = document.createElement('div');
            el.className = 'toast-notification toast-' + (type || 'info');
            const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
            el.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span><span class="toast-text">' + message + '</span>';
            document.body.appendChild(el);
            requestAnimationFrame(() => el.classList.add('show'));
            setTimeout(() => {
                el.classList.remove('show');
                setTimeout(() => el.remove(), 300);
            }, duration || 4000);
        }

        // ── Estado ──
        let recognition = null;
        let isRecording = false;
        let finalTranscript = '';
        let restartTimeout = null;

        function initRecognition() {
            const rec = new SpeechRecognition();
            rec.continuous = false;
            rec.interimResults = true;
            rec.lang = 'es-AR';
            return rec;
        }

        function wireRecognition(rec) {
            rec.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript + ' ';
                    } else {
                        interim += transcript;
                    }
                }
                chatInput.value = (finalTranscript + interim).trim();
                chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            };

            rec.onerror = (event) => {
                console.warn('[MIC] Error:', event.error, event.message);
                if (event.error === 'not-allowed') {
                    toast('\uD83C\uDFA4 Permiso de micrófono denegado. Permití el acceso en configuración del navegador.', 'error');
                    stopRecording(false);
                } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                    toast('\uD83C\uDFA4 Error de voz: ' + event.error, 'error');
                }
            };

            rec.onspeechstart = () => {
                micBtn.style.animation = 'mic-pulse 0.8s ease-in-out infinite';
            };

            rec.onspeechend = () => {
                micBtn.style.animation = '';
            };

            rec.onend = () => {
                if (!isRecording) return;
                recognition = null;
                clearTimeout(restartTimeout);
                restartTimeout = setTimeout(() => {
                    if (!isRecording) return;
                    try {
                        const newRec = initRecognition();
                        if (!newRec) return;
                        recognition = newRec;
                        wireRecognition(newRec);
                        newRec.start();
                    } catch (e) {
                        console.warn('[MIC] Reinicio fallido, reintentando:', e.message);
                        restartTimeout = setTimeout(() => {
                            if (!isRecording) return;
                            try {
                                const retryRec = initRecognition();
                                if (!retryRec) return;
                                recognition = retryRec;
                                wireRecognition(retryRec);
                                retryRec.start();
                            } catch (e2) {
                                console.error('[MIC] Reintento final fallido:', e2.message);
                                stopRecording(true);
                            }
                        }, 500);
                    }
                }, 250);
            };
        }

        function startRecording() {
            try {
                if (recognition) {
                    try { recognition.abort(); } catch (e) { /* ok */ }
                    recognition = null;
                }
                clearTimeout(restartTimeout);

                recognition = initRecognition();
                if (!recognition) return;

                isRecording = true;
                // Preservar texto existente — no borrar lo que ya se dictó/escribió antes
                const existingText = chatInput.value.trim();
                finalTranscript = existingText ? existingText + ' ' : '';
                micBtn.classList.add('mic-recording');
                const wrapper = chatInput.closest('.input-wrapper');
                if (wrapper) wrapper.classList.add('mic-active');
                micBtn.innerHTML = '\uD83D\uDD34'; // 🔴
                micBtn.title = 'Grabando... click para detener';
                chatInput.placeholder = '\uD83C\uDFA4 Te escucho... hablá ahora...';
                // NO limpiar chatInput.value — mantener el texto visible mientras se graba

                wireRecognition(recognition);
                recognition.start();

                toast('\uD83C\uDFA4 Escuchando... hablá claro. Click en \uD83D\uDD34 para detener.', 'info', 2000);
            } catch (e) {
                console.error('[MIC] Error al iniciar:', e);
                toast('\uD83C\uDFA4 Error al iniciar el micrófono.', 'error');
                stopRecording(false);
            }
        }

        function stopRecording(showFeedback) {
            if (showFeedback === undefined) showFeedback = true;
            isRecording = false;
            clearTimeout(restartTimeout);
            restartTimeout = null;

            if (recognition) {
                try { recognition.abort(); } catch (e) { /* ok */ }
                recognition = null;
            }

            micBtn.classList.remove('mic-recording');
            const wrapper = chatInput.closest('.input-wrapper');
            if (wrapper) wrapper.classList.remove('mic-active');
            micBtn.innerHTML = '\uD83C\uDFA4'; // 🎤
            micBtn.title = 'Grabar mensaje de voz (Web Speech)';
            micBtn.style.animation = '';
            chatInput.placeholder = 'Escribe una instrucción para el agente...';

            if (showFeedback && chatInput.value.trim()) {
                toast('\u2705 Texto transcrito. Editá si hace falta y enviá.', 'success', 3000);
            }
        }

        // ── Wire click handler ──
        micBtn.onclick = function () {
            if (isRecording) {
                stopRecording(true);
            } else {
                startRecording();
            }
        };

        micBtn.__micStandaloneReady = true;
        console.log('\uD83C\uDFA4 [MIC-STANDALONE] Micrófono listo — independiente de main.js');
    });
})();
