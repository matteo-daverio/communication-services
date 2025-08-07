class VoiceLiveClient {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.workletNode = null;
        this.isRecording = false;
        this.audioQueue = [];
        this.isPlayingAudio = false;
        this.isProcessingAudio = false;
        this.currentAudioSource = null;
        this.audioBuffer = [];
        this.bufferSize = 4096; // 4x larger buffer size for better audio handling
        this.silenceThreshold = 0.01;
        this.silenceCount = 0;
        this.maxSilenceCount = 50; // ~1 second of silence at 50 chunks/sec
        this.chunkCounter = 0;
        this.processingInterval = 2;
        
        // Avatar video properties
        this.avatarVideo = null;
        this.videoQueue = [];
        this.isPlayingVideo = false;
        this.currentVideoChunks = [];
        this.videoBlob = null;
        
        this.initializeElements();
        this.initializeEventListeners();
        this.initializeVisualizer();
    }
    
    initializeElements() {
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.statusElement = document.getElementById('status');
        this.logContainer = document.getElementById('log');
        this.clearLogBtn = document.getElementById('clearLog');
        this.visualizerCanvas = document.getElementById('visualizer');
        this.visualizerCtx = this.visualizerCanvas.getContext('2d');
        this.avatarVideo = document.getElementById('avatarVideo');
    }
    
    initializeEventListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.clearLogBtn.addEventListener('click', () => this.clearLog());
    }
    
    initializeVisualizer() {
        this.visualizerData = new Uint8Array(128);
        this.drawVisualizer();
    }
    
    drawVisualizer() {
        const canvas = this.visualizerCanvas;
        const ctx = this.visualizerCtx;
        const width = canvas.width;
        const height = canvas.height;
        
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);
        
        if (this.analyser) {
            this.analyser.getByteFrequencyData(this.visualizerData);
            
            const barWidth = width / this.visualizerData.length;
            let x = 0;
            
            for (let i = 0; i < this.visualizerData.length; i++) {
                const barHeight = (this.visualizerData[i] / 255) * height;
                
                const r = Math.floor(102 + (this.visualizerData[i] / 255) * 20);
                const g = Math.floor(126 + (this.visualizerData[i] / 255) * 20);
                const b = Math.floor(234 + (this.visualizerData[i] / 255) * 20);
                
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);
                
                x += barWidth;
            }
        }
        
        requestAnimationFrame(() => this.drawVisualizer());
    }
    
    async start() {
        try {
            this.addLog('Inizializzazione del sistema...', 'info');
            this.updateStatus('🟡 Connessione...', 'connecting');
            
            // Initialize WebSocket connection
            await this.initializeWebSocket();
            
            // Initialize audio
            await this.initializeAudio();
            
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            
        } catch (error) {
            this.addLog(`Errore durante l'inizializzazione: ${error.message}`, 'error');
            this.updateStatus('🔴 Errore', 'disconnected');
        }
    }
    
    async initializeWebSocket() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.addLog('Connesso al server', 'success');
                // Send start message with API key
                this.ws.send(JSON.stringify({
                    type: 'start'
                }));
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                    
                    if (data.type === 'ready') {
                        resolve();
                    } else if (data.type === 'error') {
                        reject(new Error(data.message));
                    }
                } catch (error) {
                    this.addLog(`Errore parsing messaggio: ${error.message}`, 'error');
                }
            };
            
            this.ws.onerror = (error) => {
                this.addLog('Errore WebSocket', 'error');
                reject(error);
            };
            
            this.ws.onclose = () => {
                this.addLog('Connessione WebSocket chiusa', 'warning');
                this.updateStatus('🔴 Disconnesso', 'disconnected');
            };
        });
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'ready':
                this.addLog('Azure Voice Live API connessa', 'success');
                this.updateStatus('🟢 Connesso - Pronto', 'connected');
                break;
                
            case 'audio':
                this.playAudioChunk(data.audio);
                break;
                
            case 'audio_done':
                this.addLog('Audio sintetizzato completato', 'info');
                break;
                
            case 'speech_started':
                this.addLog('Rilevato inizio parlato', 'info');
                break;
                
            case 'speech_stopped':
                this.addLog('Rilevato fine parlato', 'info');
                break;
                
            case 'response_done':
                this.addLog('Risposta completata', 'success');
                break;
                
            case 'avatar_video_chunk':
                this.handleAvatarVideoChunk(data.chunk, data.timestamp);
                break;
                
            case 'avatar_video_complete':
                this.finalizeAvatarVideo();
                break;
                
            case 'avatar_error':
                this.addLog(`Errore Avatar: ${data.message}`, 'error');
                break;
                
            case 'error':
                this.addLog(`Errore: ${data.message}`, 'error');
                break;
                
            default:
                console.log('Messaggio sconosciuto:', data);
        }
    }
    
    async initializeAudio() {
        try {
            // Get microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });
            
            // Create analyser for visualization
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            // Create audio worklet for processing
            await this.audioContext.audioWorklet.addModule(this.createAudioWorkletBlob());
            
            // Create worklet node
            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
            
            // Connect audio nodes
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);
            source.connect(this.workletNode);
            
            // Handle audio data from worklet
            this.workletNode.port.onmessage = (event) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {

                    const audioData = this.applyInputVolume(event.data.audioData);
                    const base64Audio = this.arrayBufferToBase64(audioData.buffer);

                    // Check for audio presence
                    const volume = this.calculateVolume(audioData);

                    // Add to buffer
                    this.audioBuffer.push(base64Audio);
                    this.chunkCounter++;
                    
                    // Send audio immediately
                    this.ws.send(JSON.stringify({
                        type: 'audio',
                        audio: base64Audio
                    }));
                    
                    // Check for silence
                    if (volume < this.silenceThreshold) {
                        this.silenceCount++;
                    } else {
                        this.silenceCount = 0;
                    }
                    
                    // If we detect end of speech, commit the buffer
                    if (this.silenceCount >= this.maxSilenceCount && this.audioBuffer.length > 0) {
                        this.commitAudioBuffer();
                    }
                }
            };
            
            // Setup audio output context for playback
            this.outputAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 24000
            });
            
            this.isRecording = true;
            this.updateStatus('🔴 Registrazione...', 'recording');
            this.addLog('Registrazione audio avviata', 'success');
            
        } catch (error) {
            throw new Error(`Errore inizializzazione audio: ${error.message}`);
        }
    }
    
    createAudioWorkletBlob() {
        const workletCode = `
            class AudioProcessor extends AudioWorkletProcessor {
                constructor() {
                    super();
                    this.bufferSize = 4096;
                    this.buffer = new Float32Array(this.bufferSize);
                    this.bufferIndex = 0;
                }
                
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const inputChannel = input[0];
                        
                        for (let i = 0; i < inputChannel.length; i++) {
                            this.buffer[this.bufferIndex] = inputChannel[i];
                            this.bufferIndex++;
                            
                            if (this.bufferIndex >= this.bufferSize) {
                                // Convert to 16-bit PCM
                                const pcmData = new Int16Array(this.bufferSize);
                                for (let j = 0; j < this.bufferSize; j++) {
                                    const sample = Math.max(-1, Math.min(1, this.buffer[j]));
                                    pcmData[j] = sample * 0x7FFF;
                                }
                                
                                this.port.postMessage({ audioData: pcmData });
                                this.bufferIndex = 0;
                            }
                        }
                    }
                    
                    return true;
                }
            }
            
            registerProcessor('audio-processor', AudioProcessor);
        `;
        
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }
    
    calculateVolume(audioData) {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += Math.abs(audioData[i] / 0x7FFF);
        }
        return sum / audioData.length;
    }
    
    commitAudioBuffer() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'commit'
            }));
            
            this.audioBuffer = [];
            this.silenceCount = 0;
            this.addLog('Buffer audio committato per elaborazione', 'info');
        }
    }
    
    applyInputVolume(audioData) {
        const volume = 0.5;
        const result = new Int16Array(audioData.length);
        
        for (let i = 0; i < audioData.length; i++) {
            result[i] = audioData[i] * volume;
        }
        
        return result;
    }
    
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    
    async playAudioChunk(base64Audio) {
        // Aggiungi alla coda invece di riprodurre subito
        this.audioQueue.push(base64Audio);
        if (!this.isPlayingAudio) {
            this.playNextAudio();
        }
    }

    async playNextAudio() {
        if (this.audioQueue.length === 0) {
            this.isPlayingAudio = false;
            return;
        }
        
        this.isPlayingAudio = true;
        const base64Audio = this.audioQueue.shift();
        
        try {
            // Stop current audio se presente
            if (this.currentAudioSource) {
                this.currentAudioSource.stop();
                this.currentAudioSource = null;
            }
            
            const audioBuffer = this.base64ToArrayBuffer(base64Audio);
            const pcmData = new Int16Array(audioBuffer);
            
            const volume = 0.8;
            for (let i = 0; i < pcmData.length; i++) {
                pcmData[i] = pcmData[i] * volume;
            }
            
            const floatData = new Float32Array(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
                floatData[i] = pcmData[i] / 0x7FFF;
            }
            
            const audioBuffer2 = this.outputAudioContext.createBuffer(1, floatData.length, 24000);
            audioBuffer2.getChannelData(0).set(floatData);
            
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer2;
            source.playbackRate.value = 1.0; // Inizia con velocità normale
            source.connect(this.outputAudioContext.destination);
            
            // Importante: gestisci la fine dell'audio
            source.onended = () => {
                this.currentAudioSource = null;
                setTimeout(() => this.playNextAudio(), 5); // Piccolo delay
            };
            
            this.currentAudioSource = source;
            source.start();
            
        } catch (error) {
            this.addLog(`Errore riproduzione audio: ${error.message}`, 'error');
            setTimeout(() => this.playNextAudio(), 100);
        }
    }
    
    stop() {
        this.isRecording = false;

        if (this.currentAudioSource) {
            this.currentAudioSource.stop();
            this.currentAudioSource = null;
        }
        this.audioQueue = [];
        this.isPlayingAudio = false;
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.outputAudioContext) {
            this.outputAudioContext.close();
            this.outputAudioContext = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
        
        this.updateStatus('🔴 Disconnesso', 'disconnected');
        this.addLog('Sessione terminata', 'info');
    }
    
    updateStatus(text, className) {
        this.statusElement.textContent = text;
        this.statusElement.className = `status-text ${className}`;
    }
    
    handleAvatarVideoChunk(base64Chunk, timestamp) {
        try {
            // Convert base64 to binary data
            const binaryString = atob(base64Chunk);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Add chunk to current video buffer
            this.currentVideoChunks.push(bytes);
            
            this.addLog(`Ricevuto chunk video (${bytes.length} bytes)`, 'info');
        } catch (error) {
            console.error('Error processing video chunk:', error);
            this.addLog('Errore nel processing del chunk video', 'error');
        }
    }
    
    finalizeAvatarVideo() {
        try {
            if (this.currentVideoChunks.length === 0) {
                this.addLog('Nessun chunk video da processare', 'warning');
                return;
            }
            
            // Calculate total size
            const totalSize = this.currentVideoChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            
            // Combine all chunks into a single Uint8Array
            const combinedChunks = new Uint8Array(totalSize);
            let offset = 0;
            
            for (const chunk of this.currentVideoChunks) {
                combinedChunks.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Create blob and play video
            this.videoBlob = new Blob([combinedChunks], { type: 'video/webm' });
            this.playAvatarVideo();
            
            // Clear chunks for next video
            this.currentVideoChunks = [];
            
            this.addLog(`Video avatar ricevuto (${totalSize} bytes)`, 'success');
        } catch (error) {
            console.error('Error finalizing video:', error);
            this.addLog('Errore nella finalizzazione del video', 'error');
        }
    }
    
    playAvatarVideo() {
        try {
            if (!this.videoBlob || !this.avatarVideo) {
                console.warn('Video blob or avatar element not available');
                return;
            }
            
            // Create object URL and set as video source
            const videoUrl = URL.createObjectURL(this.videoBlob);
            this.avatarVideo.src = videoUrl;
            
            // Show video and hide placeholder
            this.avatarVideo.style.display = 'block';
            const placeholder = document.querySelector('.avatar-placeholder');
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            
            // Add active class to container
            const container = document.querySelector('.avatar-container');
            if (container) {
                container.classList.add('active');
            }
            
            // Play the video
            this.avatarVideo.play().then(() => {
                this.addLog('Riproduzione video avatar iniziata', 'success');
                this.isPlayingVideo = true;
            }).catch(error => {
                console.error('Error playing avatar video:', error);
                this.addLog('Errore nella riproduzione del video avatar', 'error');
            });
            
            // Clean up the object URL when video ends
            this.avatarVideo.addEventListener('ended', () => {
                URL.revokeObjectURL(videoUrl);
                this.isPlayingVideo = false;
                this.addLog('Video avatar terminato', 'info');
                
                // Hide video and show placeholder
                this.avatarVideo.style.display = 'none';
                if (placeholder) {
                    placeholder.style.display = 'block';
                }
                
                // Remove active class from container
                if (container) {
                    container.classList.remove('active');
                }
            }, { once: true });
            
        } catch (error) {
            console.error('Error setting up video playback:', error);
            this.addLog('Errore nell\'impostazione della riproduzione video', 'error');
        }
    }
    
    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${message}`;
        
        this.logContainer.appendChild(logEntry);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
    
    clearLog() {
        this.logContainer.innerHTML = '';
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new VoiceLiveClient();
});
