const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const apiKey = '4QuSkLzVpVlCifrI2jbxMbsiAvIw0Y5W3MvyTKkNE2HL5CjbTltQJQQJ99BEACfhMk5XJ3w3AAAAACOG2WAy';

// Avatar Configuration
const AVATAR_CONFIG = {
    endpoint: 'https://mdaverio-2771-resource.cognitiveservices.azure.com/',
    apiKey: apiKey,
    avatarCharacter: 'lisa',
    avatarStyle: 'graceful-sitting',
    voiceName: 'it-IT-AlessioMultilingualNeural',
    outputFormat: 'webm-24khz-16bit-mono-opus',
    videoFormat: 'webm',
    videoCodec: 'vp9',
    videoWidth: 1920,
    videoHeight: 1080,
    videoBitrate: 2000000,
    backgroundColor: '#00FF00FF' // Green screen for easier processing
};

// Avatar session management
const avatarSessions = new Map();

// Avatar Session Class
class AvatarSession {
    constructor(clientWs) {
        this.id = uuidv4();
        this.clientWs = clientWs;
        this.isActive = false;
        this.currentText = '';
        this.textBuffer = [];
        this.videoChunks = [];
        this.isGenerating = false;
        this.lastVideoTimestamp = 0;
        this.avatarWs = null;
    }

    async initialize() {
        try {
            console.log(`Initializing avatar session: ${this.id}`);
            this.isActive = true;
            return true;
        } catch (error) {
            console.error('Error initializing avatar session:', error);
            return false;
        }
    }

    async generateVideoForText(text) {
        if (!text || text.trim().length === 0) return;
        
        this.isGenerating = true;
        this.currentText = text;
        
        try {
            await this.callAvatarAPI(text);
        } catch (error) {
            console.error('Error generating avatar video:', error);
            this.clientWs.send(JSON.stringify({
                type: 'avatar_error',
                message: 'Failed to generate avatar video'
            }));
        } finally {
            this.isGenerating = false;
        }
    }

    async callAvatarAPI(text) {
        console.log('Avatar API call for text:', text);
        
        try {
            // Create SSML with the text
            const ssml = `
                <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="it-IT">
                    <voice name="${AVATAR_CONFIG.voiceName}">
                        ${text}
                    </voice>
                </speak>
            `;

            // Configure avatar request
            const avatarRequest = {
                talkingAvatarCharacter: AVATAR_CONFIG.avatarCharacter,
                talkingAvatarStyle: AVATAR_CONFIG.avatarStyle,
                videoFormat: AVATAR_CONFIG.videoFormat,
                videoCodec: AVATAR_CONFIG.videoCodec,
                subtitleType: "soft_embedded",
                backgroundColor: AVATAR_CONFIG.backgroundColor
            };

            console.log('Starting avatar generation for:', text.substring(0, 50) + '...');

            // Call Azure Avatar TTS API
            const response = await axios.post(
                `${AVATAR_CONFIG.endpoint}avatar/talkingavatar/synthesis`,
                {
                    ssml: ssml,
                    ...avatarRequest
                },
                {
                    headers: {
                        'Ocp-Apim-Subscription-Key': AVATAR_CONFIG.apiKey,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream'
                }
            );

            // Handle streaming video response
            this.handleVideoStream(response.data);
            
        } catch (error) {
            console.error('Avatar API error:', error.response?.data || error.message);
            throw error;
        }
    }

    handleVideoStream(stream) {
        console.log('Handling video stream...');
        
        let videoBuffer = Buffer.alloc(0);
        let chunkCount = 0;

        stream.on('data', (chunk) => {
            videoBuffer = Buffer.concat([videoBuffer, chunk]);
            chunkCount++;

            // Send video chunks to client as they arrive
            if (chunkCount % 10 === 0) { // Send every 10 chunks to reduce overhead
                const base64Chunk = videoBuffer.toString('base64');
                this.clientWs.send(JSON.stringify({
                    type: 'avatar_video_chunk',
                    chunk: base64Chunk,
                    timestamp: Date.now()
                }));
                videoBuffer = Buffer.alloc(0);
            }
        });

        stream.on('end', () => {
            console.log('Video stream ended');
            
            // Send final chunk if any data remains
            if (videoBuffer.length > 0) {
                const base64Chunk = videoBuffer.toString('base64');
                this.clientWs.send(JSON.stringify({
                    type: 'avatar_video_chunk',
                    chunk: base64Chunk,
                    timestamp: Date.now()
                }));
            }

            // Notify client that video is complete
            this.clientWs.send(JSON.stringify({
                type: 'avatar_video_complete',
                timestamp: Date.now()
            }));
        });

        stream.on('error', (error) => {
            console.error('Video stream error:', error);
            this.clientWs.send(JSON.stringify({
                type: 'avatar_error',
                message: 'Video stream error'
            }));
        });
    }

    cleanup() {
        this.isActive = false;
        this.videoChunks = [];
        this.textBuffer = [];
        if (this.avatarWs) {
            this.avatarWs.close();
            this.avatarWs = null;
        }
    }
}

// Serve static files
app.use(express.static(path.join(__dirname)));

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    console.log('Client connected');
    
    let azureWs = null;
    let isAzureConnected = false;
    let audioChunksReceived = 0;
    let avatarSession = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'start') {
                if (!apiKey) {
                    ws.send(JSON.stringify({ type: 'error', message: 'API Key required' }));
                    return;
                }

                console.log('Starting connection with API Key:', apiKey);
                
                // Connect to Azure Voice Live API
                const azureEndpoint = `wss://mdaverio-2771-resource.cognitiveservices.azure.com/voice-live/realtime?api-version=2025-05-01-preview&model=gpt-4o-mini-realtime-preview`;
                azureWs = new WebSocket(azureEndpoint, {
                    headers: {
                        'api-key': apiKey
                    }
                });

                console.log('WebSocket connection established');
                
                azureWs.on('open', () => {
                    console.log('Connected to Azure Voice Live API');
                    isAzureConnected = true;
                    
                    // Send session configuration for Voice Live API
                    const sessionConfig = {
                        type: 'session.update',
                        session: {
                            instructions: 'You are a helpful agent that repeats exactly what you hear, in Italian. Do not add any additional information or context. Do not change anything. For example, "Ciao, vediamo se riesci a ripetere quello che dico.", wrong response: "Ciao, vediamo se riesco a ripetere quello che dici.", correct response: "Ciao, vediamo se riesci a ripetere quello che dico."',
                            turn_detection: {
                                type: 'azure_semantic_vad',
                                threshold: 0.5,
                                prefix_padding_ms: 200,
                                silence_duration_ms: 200,
                                remove_filler_words: false
                            },
                            // turn_detection: null,
                            input_audio_sampling_rate: 16000,
                            input_audio_noise_reduction: { type: 'azure_deep_noise_suppression' },
                            // input_audio_echo_cancellation: { type: 'server_echo_cancellation' },
                            voice: {
                                name: 'it-IT-AlessioMultilingualNeural',
                                type: 'azure-standard',
                                temperature: 0.8
                            }
                        }
                    };
                    
                    azureWs.send(JSON.stringify(sessionConfig));
                    
                    // Notify client that connection is ready
                    ws.send(JSON.stringify({ type: 'ready' }));
                });
                
                azureWs.on('message', async (azureMessage) => {
                    try {
                        const azureData = JSON.parse(azureMessage);
                        console.log('Azure message type:', azureData.type);
                        
                        // Handle different message types from Azure Voice Live API
                        if (azureData.type === 'response.audio.delta') {
                            // Forward audio chunks to client
                            ws.send(JSON.stringify({
                                type: 'audio',
                                audio: azureData.delta
                            }));
                        } else if (azureData.type === 'response.audio.done') {
                            ws.send(JSON.stringify({ type: 'audio_done' }));
                        } else if (azureData.type === 'response.text.delta') {
                            // Handle text responses if needed
                            console.log('Text delta:', azureData.delta);
                        } else if (azureData.type === 'response.text.done') {
                            console.log('Text done:', azureData.text);
                            
                            // Generate avatar video for the complete text
                            if (azureData.text && azureData.text.trim()) {
                                if (!avatarSession) {
                                    avatarSession = new AvatarSession(ws);
                                    await avatarSession.initialize();
                                    avatarSessions.set(ws, avatarSession);
                                }
                                
                                if (avatarSession.isActive) {
                                    avatarSession.generateVideoForText(azureData.text);
                                }
                            }
                        } else if (azureData.type === 'session.created') {
                            console.log('Session created:', azureData.session.id);
                        } else if (azureData.type === 'session.updated') {
                            console.log('Session updated');
                        } else if (azureData.type === 'input_audio_buffer.committed') {
                            console.log('Audio buffer committed');
                        } else if (azureData.type === 'input_audio_buffer.speech_started') {
                            console.log('Speech started');
                            ws.send(JSON.stringify({ type: 'speech_started' }));
                        } else if (azureData.type === 'input_audio_buffer.speech_stopped') {
                            console.log('Speech stopped');
                            ws.send(JSON.stringify({ type: 'speech_stopped' }));
                        } else if (azureData.type === 'conversation.item.created') {
                            console.log('Conversation item created');
                        } else if (azureData.type === 'response.created') {
                            console.log('Response created');
                        } else if (azureData.type === 'response.done') {
                            console.log('Response done');
                            ws.send(JSON.stringify({ type: 'response_done' }));
                        } else if (azureData.type === 'error') {
                            console.error('Azure error:', azureData);
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                message: azureData.error?.message || 'Azure API error' 
                            }));
                        } else {
                            console.log('Unhandled message type:', azureData.type);
                        }
                    } catch (error) {
                        console.error('Error processing Azure message:', error);
                    }
                });
                
                azureWs.on('error', (error) => {
                    console.error('Azure WebSocket error:', error);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Azure connection error' 
                    }));
                });
                
                azureWs.on('close', () => {
                    console.log('Azure WebSocket closed');
                    isAzureConnected = false;
                });
                
            } else if (data.type === 'audio' && isAzureConnected && azureWs) {
                audioChunksReceived++;

                // Forward audio data to Azure Voice Live API
                const audioMessage = {
                    type: 'input_audio_buffer.append',
                    audio: data.audio
                };
                azureWs.send(JSON.stringify(audioMessage));
                
            } else if (data.type === 'commit' && isAzureConnected && azureWs) {
                if (audioChunksReceived > 0) {
                    console.log('Committing audio buffer');
                    // Commit audio buffer and create response
                    azureWs.send(JSON.stringify({
                        type: 'input_audio_buffer.commit'
                    }));

                    // Reset counter
                    audioChunksReceived = 0;                
                }
            }
            
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: 'Server error processing message' 
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        if (azureWs) {
            azureWs.close();
        }
        if (avatarSession) {
            avatarSession.cleanup();
            avatarSessions.delete(ws);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
