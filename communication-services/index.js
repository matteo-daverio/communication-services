const { CallClient, VideoStreamRenderer, LocalVideoStream } = require('@azure/communication-calling');
const { AzureCommunicationTokenCredential } = require('@azure/communication-common');
const { AzureLogger, setLogLevel } = require("@azure/logger");
const speechSdk = require("microsoft-cognitiveservices-speech-sdk");

// Set the log level and output
setLogLevel('verbose');
AzureLogger.log = (...args) => {
    console.log(...args);
};

// Calling web sdk objects
let callAgent;
let deviceManager;
let call;
let incomingCall;
let localVideoStream;
let localVideoStreamRenderer;

// Speech Services
let speechConfig;
let audioConfig;
let speechRecognizer;
let isSpeechRecognitionActive = false;
let transcriptionText = "";

let speechSynthesizer;
let isSpeechSynthesisActive = false;
let selectedVoice = "it-IT-ElsaNeural"; // Voce di default

// Keys
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
let startTranscriptionButton = document.getElementById('start-transcription-button');
let stopTranscriptionButton = document.getElementById('stop-transcription-button');
let callStatusIndicator = document.getElementById('call-status-indicator'); 

let testTextInput = document.getElementById('test-text-input');
let testSynthesisButton = document.getElementById('test-synthesis-button');
let ttsTestResult = document.getElementById('tts-test-result');

/**
 * Inizializza la configurazione di Azure Speech Services
 * Step 2.1: Setup Speech Recognition Base
 */
async function initializeSpeechRecognition() {
    try {
        console.log('Inizializzazione Speech Recognition...');
        
        // Configura Azure Speech
        speechConfig = speechSdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
        speechConfig.speechRecognitionLanguage = "it-IT"; // Italiano
        
        // Configura l'input audio dal microfono di default
        audioConfig = speechSdk.AudioConfig.fromDefaultMicrophoneInput();
        
        // Crea il recognizer
        speechRecognizer = new speechSdk.SpeechRecognizer(speechConfig, audioConfig);
        
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
        
        return true;
        
    } catch (error) {
        console.error('Errore nell\'inizializzazione di Speech Recognition:', error);
        return false;
    }
}

/**
 * Avvia il riconoscimento vocale continuo
 */
async function startSpeechRecognition() {
    try {
        if (!speechRecognizer) {
            const success = await initializeSpeechRecognition();
            if (!success) {
                throw new Error('Inizializzazione Speech Recognition fallita');
            }
        }
        
        console.log('Avvio riconoscimento vocale...');
        transcriptionText = ""; // Reset testo
        updateTranscriptionDisplay("🎤 Riconoscimento vocale attivo... Inizia a parlare!", true);
        
        speechRecognizer.startContinuousRecognitionAsync(
            () => {
                console.log('✅ Riconoscimento vocale avviato');
                isSpeechRecognitionActive = true;
                updateUIButtons();
            },
            (error) => {
                console.error('❌ Errore nell\'avvio del riconoscimento:', error);
                updateTranscriptionDisplay(`❌ Errore nell'avvio: ${error}`, true);
                isSpeechRecognitionActive = false;
                updateUIButtons();
            }
        );
        
    } catch (error) {
        console.error('Errore nell\'avvio del riconoscimento vocale:', error);
        updateTranscriptionDisplay(`❌ Errore: ${error.message}`, true);
    }
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
                    isSpeechRecognitionActive = false;
                    updateTranscriptionDisplay(transcriptionText + "\n\n🛑 Riconoscimento vocale fermato", true);
                    updateUIButtons();
                },
                (error) => {
                    console.error('❌ Errore nel fermare il riconoscimento:', error);
                    isSpeechRecognitionActive = false;
                    updateUIButtons();
                }
            );
        }
    } catch (error) {
        console.error('Errore nel fermare il riconoscimento vocale:', error);
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
 * Sintetizza il testo in audio
 * Step 3.1: Implementazione sintesi base
 */
async function synthesizeText(text) {
    try {
        if (!text || !text.trim()) {
            console.log('❌ Nessun testo da sintetizzare');
            return false;
        }
        
        if (!speechSynthesizer) {
            const success = await initializeSpeechSynthesis();
            if (!success) {
                throw new Error('Inizializzazione Speech Synthesis fallita');
            }
        }
        
        console.log(`🔊 Sintetizzo: "${text}"`);
        isSpeechSynthesisActive = true;
        updateTTSButtons();
        
        // Crea SSML con parametri personalizzati
        const ssml = createSSML(text, selectedVoice);

        console.log(`SSML generato:\n${ssml}`);
        
        return new Promise((resolve, reject) => {
            speechSynthesizer.speakSsmlAsync(
                ssml,
                (result) => {
                    isSpeechSynthesisActive = false;
                    updateTTSButtons();
                    
                    if (result.reason === speechSdk.ResultReason.SynthesizingAudioCompleted) {
                        console.log('✅ Sintesi completata con successo');
                        resolve(true);
                    } else {
                        console.error('❌ Sintesi fallita:', result.errorDetails);
                        reject(new Error(result.errorDetails));
                    }
                },
                (error) => {
                    isSpeechSynthesisActive = false;
                    updateTTSButtons();
                    console.error('❌ Errore nella sintesi:', error);
                    reject(error);
                }
            );
        });
        
    } catch (error) {
        isSpeechSynthesisActive = false;
        updateTTSButtons();
        console.error('Errore nella sintesi del testo:', error);
        throw error;
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
 * Aggiorna lo stato dei pulsanti TTS
 */
function updateTTSButtons() {
    if (testSynthesisButton) {
        testSynthesisButton.disabled = isSpeechSynthesisActive;
        testSynthesisButton.textContent = isSpeechSynthesisActive ? '🔊 Sintetizzando...' : '🔊 Testa Sintesi';
    }
}

/**
 * Testa la sintesi vocale
 */
async function testSpeechSynthesis() {
    try {
        const testText = testTextInput ? testTextInput.value.trim() : 'Ciao, questo è un test della sintesi vocale italiana.';
        
        if (!testText) {
            if (ttsTestResult) {
                ttsTestResult.innerHTML = '<div style="color: orange;">⚠️ Inserisci del testo da sintetizzare</div>';
            }
            return false;
        }
        
        if (ttsTestResult) {
            ttsTestResult.innerHTML = '<div style="color: blue;">🔊 Sintesi in corso...</div>';
        }
        
        const success = await synthesizeText(testText);
        
        if (success && ttsTestResult) {
            ttsTestResult.innerHTML = `
                <div style="color: green;">
                    ✅ Sintesi completata!<br>
                    - Testo: "${testText}"<br>
                    - Voce: ${selectedVoice}<br>
                </div>
            `;
        }
        
        return success;
        
    } catch (error) {
        console.error('Errore nel test di sintesi:', error);
        if (ttsTestResult) {
            ttsTestResult.innerHTML = `<div style="color: red;">❌ Errore: ${error.message}</div>`;
        }
        return false;
    }
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
 * Aggiorna lo stato dei pulsanti UI
 */
function updateUIButtons() {
    const isCallActive = call && call.state === 'Connected';
    
    if (startTranscriptionButton) {
        startTranscriptionButton.disabled = isSpeechRecognitionActive || isCallActive;
    }
    if (stopTranscriptionButton) {
        stopTranscriptionButton.disabled = !isSpeechRecognitionActive;
    }
    
    updateTTSButtons();

    // Mostra informazioni sullo stato
    if (isCallActive) {
        console.log('🔄 Pulsanti aggiornati - Modalità automatica attiva');
    }
}

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

                // Step 2.3: Avvia automaticamente la trascrizione se abilitata
                console.log('📞 Chiamata connessa - Controllo trascrizione automatica...');
                if (!isSpeechRecognitionActive) {
                    console.log('🎤 Avvio automatico trascrizione...');
                    updateTranscriptionDisplay("📞 Chiamata connessa! Avvio trascrizione automatica...", true);
                    await startSpeechRecognitionForCall();
                }

            } else if (call.state === 'Disconnected') {
                connectedLabel.hidden = true;
                startCallButton.disabled = false;
                hangUpCallButton.disabled = true;
                startVideoButton.disabled = true;
                stopVideoButton.disabled = true;
                console.log(`Call ended, call end reason={code=${call.callEndReason.code}, subCode=${call.callEndReason.subCode}}`);
            
                // Step 2.3: Ferma automaticamente la trascrizione quando la chiamata termina
                console.log('📞 Chiamata terminata - Fermo trascrizione...');
                if (isSpeechRecognitionActive) {
                    updateTranscriptionDisplay(transcriptionText + "\n\n📞 Chiamata terminata - Trascrizione fermata automaticamente", true);
                    await stopSpeechRecognition();
                }
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
 * Step 2.3: Integrazione con Call State
 */
async function startSpeechRecognitionForCall() {
    try {
        if (!call || call.state !== 'Connected') {
            console.log('❌ Nessuna chiamata attiva - impossibile avviare trascrizione');
            updateTranscriptionDisplay("❌ Nessuna chiamata attiva", true);
            return false;
        }
        
        console.log('🎤 Avvio trascrizione per chiamata...');
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
    let renderer = new VideoStreamRenderer(remoteVideoStream);
    let view;
    let remoteVideoContainer = document.createElement('div');
    remoteVideoContainer.className = 'remote-video-container';

    let loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'loading-spinner';
    remoteVideoStream.on('isReceivingChanged', () => {
        try {
            if (remoteVideoStream.isAvailable) {
                const isReceiving = remoteVideoStream.isReceiving;
                const isLoadingSpinnerActive = remoteVideoContainer.contains(loadingSpinner);
                if (!isReceiving && !isLoadingSpinnerActive) {
                    remoteVideoContainer.appendChild(loadingSpinner);
                } else if (isReceiving && isLoadingSpinnerActive) {
                    remoteVideoContainer.removeChild(loadingSpinner);
                }
            }
        } catch (e) {
            console.error(e);
        }
    });

    const createView = async () => {
        // Create a renderer view for the remote video stream.
        view = await renderer.createView();
        // Attach the renderer view to the UI.
        remoteVideoContainer.appendChild(view.target);
        remoteVideosGallery.appendChild(remoteVideoContainer);
    }

    // Remote participant has switched video on/off
    remoteVideoStream.on('isAvailableChanged', async () => {
        try {
            if (remoteVideoStream.isAvailable) {
                await createView();
            } else {
                view.dispose();
                remoteVideosGallery.removeChild(remoteVideoContainer);
            }
        } catch (e) {
            console.error(e);
        }
    });

    // Remote participant has video on initially.
    if (remoteVideoStream.isAvailable) {
        try {
            await createView();
        } catch (e) {
            console.error(e);
        }
    }
}

/**
 * Start your local video stream.
 * This will send your local video stream to remote participants so they can view it.
 */
startVideoButton.onclick = async () => {
    try {
        const localVideoStream = await createLocalVideoStream();
        await call.startVideo(localVideoStream);
    } catch (error) {
        console.error(error);
    }
}

/**
 * Stop your local video stream.
 * This will stop your local video stream from being sent to remote participants.
 */
stopVideoButton.onclick = async () => {
    try {
        await call.stopVideo(localVideoStream);
    } catch (error) {
        console.error(error);
    }
}

/**
 * To render a LocalVideoStream, you need to create a new instance of VideoStreamRenderer, and then
 * create a new VideoStreamRendererView instance using the asynchronous createView() method.
 * You may then attach view.target to any UI element. 
 */
createLocalVideoStream = async () => {
    const camera = (await deviceManager.getCameras())[0];
    if (camera) {
        return new LocalVideoStream(camera);
    } else {
        console.error(`No camera device found on the system`);
    }
}

/**
 * Display your local video stream preview in your UI
 */
displayLocalVideoStream = async () => {
    try {
        localVideoStreamRenderer = new VideoStreamRenderer(localVideoStream);
        const view = await localVideoStreamRenderer.createView();
        localVideoContainer.hidden = false;
        localVideoContainer.appendChild(view.target);
    } catch (error) {
        console.error(error);
    } 
}

/**
 * Remove your local video stream preview from your UI
 */
removeLocalVideoStream = async() => {
    try {
        localVideoStreamRenderer.dispose();
        localVideoContainer.hidden = true;
    } catch (error) {
        console.error(error);
    } 
}

/**
 * End current call
 */
hangUpCallButton.addEventListener("click", async () => {
    // end the current call
    await call.hangUp();
});

/**
 * Event listeners per i pulsanti - Step 2.2
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Pulsanti trascrizione (Step 2.2)
    if (startTranscriptionButton) {
        startTranscriptionButton.onclick = async () => {
            if (call && call.state === 'Connected') {
                await startSpeechRecognitionForCall();
            } else {
                await startSpeechRecognition();
            }
        };
    }
    
    if (stopTranscriptionButton) {
        stopTranscriptionButton.onclick = async () => {
            await stopSpeechRecognition();
        };
    }

    // Event listeners per TTS - Step 3.1
    if (testSynthesisButton) {
        testSynthesisButton.onclick = async () => {
            await testSpeechSynthesis();
        };
    }
    
    // Inizializza lo stato dei pulsanti
    updateUIButtons();
    updateCallStatusIndicator('Disconnected');
});