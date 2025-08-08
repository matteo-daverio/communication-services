const { CallClient, VideoStreamRenderer, LocalVideoStream } = require('@azure/communication-calling');
const { AzureCommunicationTokenCredential } = require('@azure/communication-common');
const speechSdk = require("microsoft-cognitiveservices-speech-sdk");

// Calling web sdk objects
let callAgent;
let deviceManager;
let call;
let incomingCall;
let localVideoStream;
let localVideoStreamRenderer;

// Speech Services
let speechConfig;
let speechRecognizer;
let isSpeechRecognitionActive = false;
let transcriptionText = "";

let speechSynthesizer;
let selectedVoice = "it-IT-ElsaNeural"; // Voce di default

// Streaming / synthesis state (pruned to essentials)
let partialTextBuffer = "";          // Testo già sintetizzato in streaming
let synthesisQueue = [];              // Coda segmenti in attesa
let isSynthesisInProgress = false;    // Flag sintesi in corso
let minWordsForSynthesis = 3;         // Soglia minima parole per iniziare
let lastPartialText = "";            // Ultimo testo parziale ricevuto
let hasSynthesizedAnything = false;   // Se almeno un segmento è stato sintetizzato per la frase corrente

// Speech-to-Speech Pipeline
let speechToSpeechActive = false;
let speechToSpeechButton = document.getElementById('speech-to-speech-button');
let speechToSpeechStatus = document.getElementById('speech-to-speech-status');
let audioContext; // (attualmente non usato per manipolare l'audio, ma mantenuto per futura estensione)

// Keys (TODO: rimuovere dal client in produzione)
const SPEECH_KEY = "8uWUVin2iDOx5aHsKRJqqLlWa0G6C08XKf3Zt7AYHf6vnV5Hkuz0JQQJ99BHACfhMk5XJ3w3AAAYACOGdnaN";
const SPEECH_REGION = "swedencentral";

// UI widgets
let userAccessToken = document.getElementById('user-access-token');
let calleeAcsUserId = document.getElementById('callee-acs-user-id');
let initializeCallAgentButton = document.getElementById('initialize-call-agent');
let startCallButton = document.getElementById('start-call-button');
let hangUpCallButton = document.getElementById('hangup-call-button');
let acceptCallButton = document.getElementById('accept-call-button');
let startVideoButton = document.getElementById('start-video-button');
let stopVideoButton = document.getElementById('stop-video-button');
let connectedLabel = document.getElementById('connectedLabel');
let remoteVideosGallery = document.getElementById('remoteVideosGallery');
let localVideoContainer = document.getElementById('localVideoContainer');
let transcriptionTextElement = document.getElementById('transcription-text');
let callStatusIndicator = document.getElementById('call-status-indicator'); 
let tokenCredential; // dichiarazione aggiunta per evitare implicit global

/**
 * Inizializza la configurazione di Azure Speech Services
 * Setup Speech Recognition Base
 */
async function initializeSpeechRecognition() {
    try {
        console.log('Inizializzazione Speech Recognition...');
        
        // Configura Azure Speech
        speechConfig = speechSdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
        speechConfig.speechRecognitionLanguage = "it-IT"; // Italiano
        
        console.log('✅ Speech Config inizializzato (senza audio config)');
        return true;
        
    } catch (error) {
        console.error('Errore nell\'inizializzazione di Speech Recognition:', error);
        return false;
    }
}

/**
 * Crea un recognizer con configurazione audio dedicata
 */
function createSpeechRecognizer() {
    try {
        // Usa una configurazione audio separata per evitare conflitti con ACS
        const dedicatedAudioConfig = speechSdk.AudioConfig.fromDefaultMicrophoneInput();
        
        // Crea un nuovo recognizer per ogni sessione
        const recognizer = new speechSdk.SpeechRecognizer(speechConfig, dedicatedAudioConfig);
        
        console.log('✅ Speech Recognizer creato con audio config dedicato');
        return recognizer;
        
    } catch (error) {
        console.error('❌ Errore nella creazione del recognizer:', error);
        return null;
    }
}

/**
 * Avvia il riconoscimento vocale continuo
 */
async function startSpeechRecognition() {
    try {
        // Ferma eventuali recognizer precedenti
        if (speechRecognizer) {
            await stopSpeechRecognition();
        }
        if (!speechConfig) {
            const success = await initializeSpeechRecognition();
            if (!success) {
                throw new Error('Inizializzazione Speech Recognition fallita');
            }
        }
        speechRecognizer = createSpeechRecognizer();
        if (!speechRecognizer) {
            throw new Error('Creazione Speech Recognizer fallita');
        }
        setupBasicRecognizerEvents();
        transcriptionText = "";
        updateTranscriptionDisplay("🎤 Riconoscimento vocale attivo... Inizia a parlare!", true);
        // Ritorna una Promise che si risolve a true/false
        return await new Promise(resolve => {
            speechRecognizer.startContinuousRecognitionAsync(
                () => {
                    isSpeechRecognitionActive = true;
                    updateUIButtons();
                    resolve(true);
                },
                (error) => {
                    console.error('❌ Errore nell\'avvio del riconoscimento:', error);
                    updateTranscriptionDisplay(`❌ Errore nell'avvio: ${error}`, true);
                    isSpeechRecognitionActive = false;
                    updateUIButtons();
                    resolve(false);
                }
            );
        });
    } catch (error) {
        console.error('Errore nell\'avvio del riconoscimento vocale:', error);
        updateTranscriptionDisplay(`❌ Errore: ${error.message}`, true);
        return false;
    }
}

/**
 * Configura gli event handlers base per il recognizer
 */
function setupBasicRecognizerEvents() {
    if (!speechRecognizer) return;
    
    // Event handler per riconoscimento in corso (testo parziale)
    speechRecognizer.recognizing = (s, e) => {
        const partialText = e.result.text;
        console.log(`RECOGNIZING: ${partialText}`);
        updateTranscriptionDisplay(`[Riconoscendo...] ${partialText}`, false);
    };
    
    // Event handler per riconoscimento completato (testo finale)
    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason === speechSdk.ResultReason.RecognizedSpeech) {
            const finalText = e.result.text;
            console.log(`RECOGNIZED: ${finalText}`);
            
            if (finalText.trim()) {
                transcriptionText += finalText + " ";
                updateTranscriptionDisplay(transcriptionText, true);
            }
        }
    };
    
    // Event handler per errori o cancellazioni
    speechRecognizer.canceled = (s, e) => {
        console.log(`CANCELED: Reason=${e.reason}`);
        
        if (e.reason === speechSdk.CancellationReason.Error) {
            console.error(`Speech recognition error: ${e.errorDetails}`);
            updateTranscriptionDisplay(`❌ Errore: ${e.errorDetails}`, true);
        }
    };
    
    // Event handler per fine sessione
    speechRecognizer.sessionStopped = (s, e) => {
        console.log('Speech recognition session stopped');
        isSpeechRecognitionActive = false;
        updateUIButtons();
    };
}

/**
 * Ferma il riconoscimento vocale
 */
async function stopSpeechRecognition() {
    try {
        if (speechRecognizer && isSpeechRecognitionActive) {
            console.log('Fermo riconoscimento vocale...');
            
            speechRecognizer.stopContinuousRecognitionAsync(
                () => {
                    console.log('✅ Riconoscimento vocale fermato');

                    // Pulisci il recognizer
                    speechRecognizer.close();
                    speechRecognizer = null;

                    isSpeechRecognitionActive = false;
                    updateTranscriptionDisplay(transcriptionText + "\n\n🛑 Riconoscimento vocale fermato", true);
                    updateUIButtons();
                },
                (error) => {
                    console.error('❌ Errore nel fermare il riconoscimento:', error);

                    // Forza pulizia anche in caso di errore
                    if (speechRecognizer) {
                        speechRecognizer.close();
                        speechRecognizer = null;
                    }

                    isSpeechRecognitionActive = false;
                    updateUIButtons();
                }
            );
        }
    } catch (error) {
        console.error('Errore nel fermare il riconoscimento vocale:', error);

        // Forza pulizia in caso di errore
        if (speechRecognizer) {
            speechRecognizer.close();
            speechRecognizer = null;
        }
        isSpeechRecognitionActive = false;
        updateUIButtons();
    }
}

/**
 * Inizializza Azure Speech Synthesis
 */
async function initializeSpeechSynthesis() {
    try {
        console.log('Inizializzazione Speech Synthesis...');
        
        if (!speechConfig) {
            // Riusa la configurazione esistente o creane una nuova
            speechConfig = speechSdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
        }
        
        // Configura la lingua per la sintesi
        speechConfig.speechSynthesisLanguage = "it-IT";
        speechConfig.speechSynthesisVoiceName = selectedVoice;
        
        // Crea il synthesizer
        speechSynthesizer = new speechSdk.SpeechSynthesizer(speechConfig);
        
        console.log('Speech Synthesis configurato correttamente');
        console.log(`Voce selezionata: ${selectedVoice}`);
        
        return true;
        
    } catch (error) {
        console.error('Errore nell\'inizializzazione di Speech Synthesis:', error);
        return false;
    }
}

/**
 * Crea SSML personalizzato per la sintesi
 */
function createSSML(text, voice) {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="it-IT">
            <voice name="${voice}">
                ${text}
            </voice>
        </speak>`;
}

/**
 * Aggiorna la visualizzazione della trascrizione
 */
function updateTranscriptionDisplay(text, isFinal) {
    if (transcriptionTextElement) {
        if (isFinal) {
            transcriptionTextElement.innerHTML = text.replace(/\n/g, '<br>');
        } else {
            // Per il testo parziale, mostra in corsivo
            transcriptionTextElement.innerHTML = transcriptionText + '<i style="color: #666;">' + text + '</i>';
        }
        
        // Auto-scroll verso il basso
        transcriptionTextElement.scrollTop = transcriptionTextElement.scrollHeight;
    }
}

/**
 * Inizializza la pipeline Speech-to-Speech
 */
async function initializeSpeechToSpeechPipeline() {
    try {
        console.log('🔄 Inizializzazione pipeline Speech-to-Speech...');
        
        // Verifica che sia STT che TTS siano configurati
        if (!speechRecognizer) {
            const sttSuccess = await initializeSpeechRecognition();
            if (!sttSuccess) {
                throw new Error('Inizializzazione STT fallita');
            }
        }
        
        if (!speechSynthesizer) {
            const ttsSuccess = await initializeSpeechSynthesis();
            if (!ttsSuccess) {
                throw new Error('Inizializzazione TTS fallita');
            }
        }
        
        // Inizializza Web Audio API per la manipolazione dell'audio
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        console.log('✅ Pipeline Speech-to-Speech inizializzata');
        return true;
        
    } catch (error) {
        console.error('❌ Errore nell\'inizializzazione pipeline:', error);
        return false;
    }
}

/**
 * Avvia la pipeline Speech-to-Speech
 */
async function startSpeechToSpeechPipeline() {
    try {
        if (!call || call.state !== 'Connected') {
            throw new Error('Nessuna chiamata attiva');
        }
        
        console.log('🚀 Avvio pipeline Speech-to-Speech...');
        updateSpeechToSpeechStatus('🔄 Inizializzazione...', 'orange');

        // Reset completo variabili streaming
        resetStreamingState();

        // Ferma eventuali riconoscimenti precedenti
        if (speechRecognizer) {
            await stopSpeechRecognition();
            // Aspetta un momento per assicurarsi che il microfono sia liberato
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Inizializza la pipeline se necessario
        if (!audioContext) {
            const success = await initializeSpeechToSpeechPipeline();
            if (!success) {
                throw new Error('Inizializzazione pipeline fallita');
            }
        }

        // Crea un nuovo recognizer per la pipeline
        console.log('🎤 Creazione recognizer per pipeline...');
        speechRecognizer = createSpeechRecognizer();
        if (!speechRecognizer) {
            throw new Error('Creazione recognizer pipeline fallita');
        }
        
        // Configura il recognizer per la pipeline
        await setupPipelineRecognizer();
        
        // Avvia il riconoscimento vocale
        console.log('🎤 Avvio riconoscimento per pipeline...');
        speechRecognizer.startContinuousRecognitionAsync(
            () => {
                console.log('✅ Pipeline Speech-to-Speech con tracking avanzato attiva');
                speechToSpeechActive = true;
                updateSpeechToSpeechStatus('🔄 Pipeline Tracking Attiva - Parla!', 'green');
                updateSpeechToSpeechButtons();
                
                // Aggiorna la trascrizione
                updateTranscriptionDisplay("🔄 Pipeline Speech-to-Speech con tracking avanzato attiva!\n🎤 Nessuna ripetizione garantita...\n\n", true);
            },
            (error) => {
                console.error('❌ Errore nell\'avvio pipeline:', error);
                speechToSpeechActive = false;
                updateSpeechToSpeechStatus('❌ Errore nell\'avvio', 'red');
                updateSpeechToSpeechButtons();
            }
        );
        
    } catch (error) {
        console.error('❌ Errore nell\'avvio pipeline Speech-to-Speech:', error);
        speechToSpeechActive = false;
        updateSpeechToSpeechStatus(`❌ Errore: ${error.message}`, 'red');
        updateSpeechToSpeechButtons();
    }
}

/**
 * Ferma la pipeline Speech-to-Speech
 */
async function stopSpeechToSpeechPipeline() {
    try {
        console.log('🛑 Fermo pipeline Speech-to-Speech...');

        // Reset variabili streaming
        resetStreamingState();
        
        if (speechRecognizer && speechToSpeechActive) {
            speechRecognizer.stopContinuousRecognitionAsync(
                () => {
                    console.log('✅ Pipeline Speech-to-Speech fermata');

                    // Pulisci il recognizer
                    speechRecognizer.close();
                    speechRecognizer = null;

                    speechToSpeechActive = false;
                    updateSpeechToSpeechStatus('🛑 Pipeline Fermata', 'gray');
                    updateSpeechToSpeechButtons();
                    
                    updateTranscriptionDisplay(transcriptionText + "\n\n🛑 Pipeline Speech-to-Speech fermata", true);
                },
                (error) => {
                    console.error('❌ Errore nel fermare pipeline:', error);

                    // Forza pulizia anche in caso di errore
                    if (speechRecognizer) {
                        speechRecognizer.close();
                        speechRecognizer = null;
                    }

                    speechToSpeechActive = false;
                    updateSpeechToSpeechStatus('❌ Errore nel fermare', 'red');
                    updateSpeechToSpeechButtons();
                }
            );
        }
        
        // Pulisci risorse audio
        if (audioContext && audioContext.state !== 'closed') {
            await audioContext.close();
            audioContext = null;
        }
        
    } catch (error) {
        console.error('❌ Errore nel fermare pipeline:', error);
        speechToSpeechActive = false;
        updateSpeechToSpeechButtons();
    }
}

/**
 * Configura il recognizer per la pipeline
 */
async function setupPipelineRecognizer() {
    try {
        if (!speechRecognizer) {
            throw new Error('Nessun recognizer disponibile');
        }
        
        console.log('🔧 Configurazione recognizer per pipeline...');
        
        // Event handler per riconoscimento in corso (pipeline) - SINTESI STABILE
        speechRecognizer.recognizing = async (s, e) => {
            const partialText = e.result.text;
            console.log(`PIPELINE RECOGNIZING: ${partialText}`);
            updateTranscriptionDisplay(`[Pipeline - Riconoscendo...] ${partialText}`, false);

            // Sintesi streaming del testo parziale con controllo stabilità
            if (speechToSpeechActive && partialText.trim()) {
                await handleStreamingSynthesis(partialText);
            }
        };
        
        // Event handler per riconoscimento completato (pipeline) - COMPLETAMENTO
        speechRecognizer.recognized = async (s, e) => {
            if (e.result.reason === speechSdk.ResultReason.RecognizedSpeech) {
                const finalText = e.result.text;
                console.log(`PIPELINE RECOGNIZED: ${finalText}`);
                
                if (finalText.trim() && speechToSpeechActive) {
                    // Aggiorna la trascrizione
                    transcriptionText += `[TU]: ${finalText} `;
                    updateTranscriptionDisplay(transcriptionText, true);
                    
                    // Completa la sintesi finale
                    console.log('🔄 Completamento sintesi finale...');
                    updateSpeechToSpeechStatus('🔊 Completamento...', 'blue');
                    
                    try {
                        await completeFinalSynthesis(finalText);
                        updateSpeechToSpeechStatus('🔄 Pipeline Attiva - Parla!', 'green');
                    } catch (synthError) {
                        console.error('❌ Errore completamento sintesi:', synthError);
                        updateSpeechToSpeechStatus('⚠️ Errore completamento', 'orange');
                    }
                }
            }
        };
        
        // Event handler per errori nella pipeline
        speechRecognizer.canceled = (s, e) => {
            console.log(`PIPELINE CANCELED: Reason=${e.reason}`);
            
            if (e.reason === speechSdk.CancellationReason.Error) {
                console.error(`Pipeline error: ${e.errorDetails}`);
                updateSpeechToSpeechStatus(`❌ Errore: ${e.errorDetails}`, 'red');
                speechToSpeechActive = false;
                updateSpeechToSpeechButtons();
            }
        };

        // Event handler per fine sessione pipeline - UPDATED con reset tracking
        speechRecognizer.sessionStopped = (s, e) => {
            console.log('Pipeline speech recognition session stopped');
            speechToSpeechActive = false;
            resetStreamingState();
            updateSpeechToSpeechButtons();
        };
        
        console.log('✅ Recognizer configurato per pipeline con tracking avanzato');
        
    } catch (error) {
        console.error('❌ Errore configurazione recognizer pipeline:', error);
        throw error;
    }
}

/**
 * Gestisce la sintesi streaming del testo parziale
 */
async function handleStreamingSynthesis(partialText) {
    const stableWords = getStableWords(partialText, lastPartialText);
    lastPartialText = partialText;
    const stableWordList = stableWords.trim().split(/\s+/).filter(w => w);
    if (!stableWordList.length) return;

    // Primo avvio streaming
    if (!partialTextBuffer && stableWordList.length >= minWordsForSynthesis) {
        partialTextBuffer = stableWords.trim();
        await synthesizeStreamingSegment(partialTextBuffer);
        hasSynthesizedAnything = true;
        return;
    }
    if (partialTextBuffer) {
        const current = partialTextBuffer.trim().split(/\s+/);
        if (stableWordList.length > current.length) {
            const additional = stableWordList.slice(current.length);
            if (additional.length) {
                partialTextBuffer = stableWords.trim();
                const addText = additional.join(' ');
                if (!isSynthesisInProgress) {
                    await synthesizeStreamingSegment(addText);
                    hasSynthesizedAnything = true;
                } else {
                    synthesisQueue.push(addText);
                }
            }
        }
    }
}

function getStableWords(currentText, previousText) {
    if (!previousText) return "";
    const cur = currentText.trim().split(/\s+/);
    const prev = previousText.trim().split(/\s+/);
    const out = [];
    const len = Math.min(cur.length, prev.length);
    for (let i = 0; i < len - 1; i++) { // esclude ultima parola (potrebbe mutare)
        if (cur[i] === prev[i]) out.push(cur[i]); else break;
    }
    return out.join(' ');
}

async function synthesizeStreamingSegment(text) {
    if (!text || !text.trim()) return false;
    if (isSynthesisInProgress) { synthesisQueue.push(text); return true; }
    if (!speechSynthesizer && !(await initializeSpeechSynthesis())) throw new Error('TTS init failed');

    isSynthesisInProgress = true;
    const ssml = createSSML(text, selectedVoice);
    return new Promise((resolve, reject) => {
        speechSynthesizer.speakSsmlAsync(ssml, async result => {
            isSynthesisInProgress = false;
            if (result.reason === speechSdk.ResultReason.SynthesizingAudioCompleted) {
                if (synthesisQueue.length) {
                    const next = synthesisQueue.shift();
                    await synthesizeStreamingSegment(next);
                }
                resolve(true);
            } else {
                reject(new Error(result.errorDetails));
            }
        }, err => { isSynthesisInProgress = false; reject(err); });
    });
}

async function completeFinalSynthesis(finalText) {
    // Nessuna sintesi parziale precedente -> sintetizza tutto
    if (!hasSynthesizedAnything) { await synthesizeStreamingSegment(finalText); resetStreamingState(); return; }
    if (!partialTextBuffer) { resetStreamingState(); return; }

    const finalWords = finalText.split(/\s+/).filter(w => w);
    const processed = partialTextBuffer.split(/\s+/).filter(w => w);
    let i = 0; while (i < Math.min(finalWords.length, processed.length) && finalWords[i].toLowerCase() === processed[i].toLowerCase()) i++;
    const remaining = finalWords.slice(i);
    if (remaining.length) await synthesizeStreamingSegment(remaining.join(' '));
    resetStreamingState();
}

/**
 * Aggiorna lo stato della pipeline
 */
function updateSpeechToSpeechStatus(message, color) {
    if (speechToSpeechStatus) speechToSpeechStatus.innerHTML = `<strong style="color:${color};">${message}</strong>`;
}

/**
 * Aggiorna i pulsanti della pipeline
 */
function updateSpeechToSpeechButtons() {
    const isCallActive = call && call.state === 'Connected';
    if (speechToSpeechButton) {
        speechToSpeechButton.disabled = !isCallActive;
        speechToSpeechButton.textContent = speechToSpeechActive ? '🛑 Ferma Pipeline' : '🔄 Avvia Pipeline Speech-to-Speech';
    }
}

/**
 * Aggiorna lo stato dei pulsanti UI
 */
function updateUIButtons() { updateSpeechToSpeechButtons(); }

/**
 * Using the CallClient, initialize a CallAgent instance with a CommunicationUserCredential which will enable us to make outgoing calls and receive incoming calls. 
 * You can then use the CallClient.getDeviceManager() API instance to get the DeviceManager.
 */
initializeCallAgentButton.onclick = async () => {
    try {
        const callClient = new CallClient(); 
        tokenCredential = new AzureCommunicationTokenCredential(userAccessToken.value.trim());
        callAgent = await callClient.createCallAgent(tokenCredential)
        // Set up a camera device to use.
        deviceManager = await callClient.getDeviceManager();
        await deviceManager.askDevicePermission({ video: true });
        await deviceManager.askDevicePermission({ audio: true });
        // Listen for an incoming call to accept.
        callAgent.on('incomingCall', async (args) => {
            try {
                incomingCall = args.incomingCall;
                acceptCallButton.disabled = false;
                startCallButton.disabled = true;
            } catch (error) {
                console.error(error);
            }
        });

        startCallButton.disabled = false;
        initializeCallAgentButton.disabled = true;
    } catch(error) {
        console.error(error);
    }
}

/**
 * Place a 1:1 outgoing video call to a user
 * Add an event listener to initiate a call when the `startCallButton` is clicked:
 * First you have to enumerate local cameras using the deviceManager `getCameraList` API.
 * In this quickstart we're using the first camera in the collection. Once the desired camera is selected, a
 * LocalVideoStream instance will be constructed and passed within `videoOptions` as an item within the
 * localVideoStream array to the call method. Once your call connects it will automatically start sending a video stream to the other participant. 
 */
startCallButton.onclick = async () => {
    try {
        const localVideoStream = await createLocalVideoStream();
        const videoOptions = localVideoStream ? { localVideoStreams: [localVideoStream] } : undefined;
        call = callAgent.startCall([{ communicationUserId: calleeAcsUserId.value.trim() }], { videoOptions });
        // Subscribe to the call's properties and events.
        subscribeToCall(call);
    } catch (error) {
        console.error(error);
    }
}

/**
 * Accepting an incoming call with video
 * Add an event listener to accept a call when the `acceptCallButton` is clicked:
 * After subscribing to the `CallAgent.on('incomingCall')` event, you can accept the incoming call.
 * You can pass the local video stream which you want to use to accept the call with.
 */
acceptCallButton.onclick = async () => {
    try {
        const localVideoStream = await createLocalVideoStream();
        const videoOptions = localVideoStream ? { localVideoStreams: [localVideoStream] } : undefined;
        call = await incomingCall.accept({ videoOptions });
        // Subscribe to the call's properties and events.
        subscribeToCall(call);
    } catch (error) {
        console.error(error);
    }
}

/**
 * Subscribe to a call obj.
 * Listen for property changes and collection updates.
 */
subscribeToCall = (call) => {
    try {
        // Inspect the initial call.id value.
        console.log(`Call Id: ${call.id}`);
        //Subscribe to call's 'idChanged' event for value changes.
        call.on('idChanged', () => {
            console.log(`Call Id changed: ${call.id}`); 
        });

        // Inspect the initial call.state value.
        console.log(`Call state: ${call.state}`);
        // Subscribe to call's 'stateChanged' event for value changes.
        call.on('stateChanged', async () => {
            console.log(`Call state changed: ${call.state}`);

            // Aggiorna indicatore di stato
            updateCallStatusIndicator(call.state);

            if (call.state === 'Connected') {
                connectedLabel.hidden = false;
                acceptCallButton.disabled = true;
                startCallButton.disabled = true;
                hangUpCallButton.disabled = false;
                startVideoButton.disabled = false;
                stopVideoButton.disabled = false;
                remoteVideosGallery.hidden = false;

                // Avvia automaticamente la trascrizione se abilitata
                console.log('📞 Chiamata connessa - Controllo trascrizione automatica...');
                updateSpeechToSpeechStatus('✅ Pronto per Pipeline', 'green');

                if (!isSpeechRecognitionActive) {
                    console.log('🎤 Avvio automatico trascrizione...');
                    updateTranscriptionDisplay("📞 Chiamata connessa! Avvio trascrizione automatica...", true);
                    await startSpeechRecognitionForCall();
                }

                // Attiva automaticamente la pipeline
                if (!speechToSpeechActive) {
                    console.log('📞 Avvio automatico pipeline...');
                    await startSpeechToSpeechPipeline();
                }

            } else if (call.state === 'Disconnected') {
                connectedLabel.hidden = true;
                startCallButton.disabled = false;
                hangUpCallButton.disabled = true;
                startVideoButton.disabled = true;
                stopVideoButton.disabled = true;
                console.log(`Call ended, call end reason={code=${call.callEndReason.code}, subCode=${call.callEndReason.subCode}}`);
            
                //  Ferma automaticamente la trascrizione quando la chiamata termina
                console.log('📞 Chiamata terminata - Fermo trascrizione...');
                if (isSpeechRecognitionActive) {
                    updateTranscriptionDisplay(transcriptionText + "\n\n📞 Chiamata terminata - Trascrizione fermata automaticamente", true);
                    await stopSpeechRecognition();
                }

                // Ferma automaticamente la pipeline quando la chiamata termina
                if (speechToSpeechActive) {
                    console.log('📞 Chiamata terminata - Fermo pipeline...');
                    await stopSpeechToSpeechPipeline();
                }
                
                updateSpeechToSpeechStatus('📞 Chiamata Terminata', 'gray');
            }   
        });

        call.on('isLocalVideoStartedChanged', () => {
            console.log(`isLocalVideoStarted changed: ${call.isLocalVideoStarted}`);
        });
        console.log(`isLocalVideoStarted: ${call.isLocalVideoStarted}`);
        call.localVideoStreams.forEach(async (lvs) => {
            localVideoStream = lvs;
            await displayLocalVideoStream();
        });
        call.on('localVideoStreamsUpdated', e => {
            e.added.forEach(async (lvs) => {
                localVideoStream = lvs;
                await displayLocalVideoStream();
            });
            e.removed.forEach(lvs => {
               removeLocalVideoStream();
            });
        });
        
        // Inspect the call's current remote participants and subscribe to them.
        call.remoteParticipants.forEach(remoteParticipant => {
            subscribeToRemoteParticipant(remoteParticipant);
        });
        // Subscribe to the call's 'remoteParticipantsUpdated' event to be
        // notified when new participants are added to the call or removed from the call.
        call.on('remoteParticipantsUpdated', e => {
            // Subscribe to new remote participants that are added to the call.
            e.added.forEach(remoteParticipant => {
                subscribeToRemoteParticipant(remoteParticipant)
            });
            // Unsubscribe from participants that are removed from the call
            e.removed.forEach(remoteParticipant => {
                console.log('Remote participant removed from the call.');
            });
        });
    } catch (error) {
        console.error(error);
    }
}

/**
 * Avvia il riconoscimento vocale specificamente per la chiamata
 * Integrazione con Call State
 */
async function startSpeechRecognitionForCall() {
    try {
        if (!call || call.state !== 'Connected') {
            console.log('❌ Nessuna chiamata attiva - impossibile avviare trascrizione');
            updateTranscriptionDisplay("❌ Nessuna chiamata attiva", true);
            return false;
        }
        const success = await startSpeechRecognition();
        if (success) {
            updateTranscriptionDisplay("📞 Trascrizione attiva durante la chiamata\n🎤 Parla e vedrai la trascrizione qui...\n\n", true);
        }
        return success;
    } catch (error) {
        console.error('Errore nell\'avvio trascrizione per chiamata:', error);
        updateTranscriptionDisplay(`❌ Errore: ${error.message}`, true);
        return false;
    }
}

/**
 * Aggiorna l'indicatore di stato della chiamata
 */
function updateCallStatusIndicator(callState) {
    if (callStatusIndicator) {
        let statusText = "";
        let statusColor = "";
        
        switch (callState) {
            case 'Connected':
                statusText = "📞 Chiamata Connessa";
                statusColor = "#4CAF50";
                break;
            case 'Connecting':
                statusText = "📞 Connessione in corso...";
                statusColor = "#FF9800";
                break;
            case 'Disconnected':
                statusText = "📞 Chiamata Terminata";
                statusColor = "#f44336";
                break;
            case 'Ringing':
                statusText = "📞 Squillo...";
                statusColor = "#2196F3";
                break;
            default:
                statusText = `📞 Stato: ${callState}`;
                statusColor = "#666";
        }
        
        callStatusIndicator.innerHTML = `<strong style="color: ${statusColor};">${statusText}</strong>`;
        console.log(`📞 Stato chiamata aggiornato: ${callState}`);
    }
}

/**
 * Subscribe to a remote participant obj.
 * Listen for property changes and collection updates.
 */
subscribeToRemoteParticipant = (remoteParticipant) => {
    try {
        // Inspect the initial remoteParticipant.state value.
        console.log(`Remote participant state: ${remoteParticipant.state}`);
        // Subscribe to remoteParticipant's 'stateChanged' event for value changes.
        remoteParticipant.on('stateChanged', () => {
            console.log(`Remote participant state changed: ${remoteParticipant.state}`);
        });

        // Inspect the remoteParticipants's current videoStreams and subscribe to them.
        remoteParticipant.videoStreams.forEach(remoteVideoStream => {
            subscribeToRemoteVideoStream(remoteVideoStream)
        });
        // Subscribe to the remoteParticipant's 'videoStreamsUpdated' event to be
        // notified when the remoteParticipant adds new videoStreams and removes video streams.
        remoteParticipant.on('videoStreamsUpdated', e => {
            // Subscribe to new remote participant's video streams that were added.
            e.added.forEach(remoteVideoStream => {
                subscribeToRemoteVideoStream(remoteVideoStream)
            });
            // Unsubscribe from remote participant's video streams that were removed.
            e.removed.forEach(remoteVideoStream => {
                console.log('Remote participant video stream was removed.');
            })
        });
    } catch (error) {
        console.error(error);
    }
}

/**
 * Subscribe to a remote participant's remote video stream obj.
 * You have to subscribe to the 'isAvailableChanged' event to render the remoteVideoStream. If the 'isAvailable' property
 * changes to 'true', a remote participant is sending a stream. Whenever availability of a remote stream changes
 * you can choose to destroy the whole 'Renderer', a specific 'RendererView' or keep them, but this will result in displaying blank video frame.
 */
subscribeToRemoteVideoStream = async (remoteVideoStream) => {
    const renderer = new VideoStreamRenderer(remoteVideoStream);
    let view;
    const container = document.createElement('div');
    container.className = 'remote-video-container';

    const createView = async () => {
        view = await renderer.createView();
        container.appendChild(view.target);
        remoteVideosGallery.appendChild(container);
    };

    remoteVideoStream.on('isAvailableChanged', async () => {
        try {
            if (remoteVideoStream.isAvailable) await createView(); else if (view) { view.dispose(); remoteVideosGallery.removeChild(container); }
        } catch (e) { console.error(e); }
    });
    if (remoteVideoStream.isAvailable) {
        try { await createView(); } catch (e) { console.error(e); }
    }
}

/**
 * Start your local video stream.
 * This will send your local video stream to remote participants so they can view it.
 */
startVideoButton.onclick = async () => {
    try { const lvs = await createLocalVideoStream(); await call.startVideo(lvs); } catch (e) { console.error(e); }
};

/**
 * Stop your local video stream.
 * This will stop your local video stream from being sent to remote participants.
 */
stopVideoButton.onclick = async () => { try { await call.stopVideo(localVideoStream); } catch (e) { console.error(e); } };

createLocalVideoStream = async () => {
    const cam = (await deviceManager.getCameras())[0];
    if (cam) return new LocalVideoStream(cam);
    console.error('Nessuna camera trovata');
};

displayLocalVideoStream = async () => {
    try {
        localVideoStreamRenderer = new VideoStreamRenderer(localVideoStream);
        const view = await localVideoStreamRenderer.createView();
        localVideoContainer.hidden = false;
        localVideoContainer.appendChild(view.target);
    } catch (e) { console.error(e); }
};

removeLocalVideoStream = () => {
    try { if (localVideoStreamRenderer) localVideoStreamRenderer.dispose(); localVideoContainer.hidden = true; } catch (e) { console.error(e); }
};

hangUpCallButton.addEventListener("click", async () => { if (call) await call.hangUp(); });

/**
 * Event listeners per i pulsanti
 */
document.addEventListener('DOMContentLoaded', () => {
    // Event listeners per Pipeline Speech-to-Speech
    if (speechToSpeechButton) {
        speechToSpeechButton.onclick = async () => {
            if (speechToSpeechActive) await stopSpeechToSpeechPipeline(); else await startSpeechToSpeechPipeline();
        };
    }
    
    // Inizializza lo stato dei pulsanti
    updateUIButtons();
    updateCallStatusIndicator('Disconnected');
    updateSpeechToSpeechStatus('📞 Nessuna chiamata attiva', 'gray');
});

// Funzione mancante aggiunta per resettare lo stato streaming
function resetStreamingState() {
    partialTextBuffer = "";
    synthesisQueue = [];
    isSynthesisInProgress = false;
    lastPartialText = "";
    hasSynthesizedAnything = false;
}