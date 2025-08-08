import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';
import { configureUI, setHooks, initializeAgent, startCall, acceptCall, startVideo, stopVideo, hangUp, getCall } from './callManager';
import { initializeSpeechRecognition, setTranscriptionElement, getSpeechConfig } from './speechRecognition';
import { initializeSpeechSynthesis } from './speechSynthesis';
import { configure as configurePipeline, startPipeline, stopPipeline, isActive as pipelineActive, setRecognizer } from './streamingPipeline';

const SPEECH_KEY = "8uWUVin2iDOx5aHsKRJqqLlWa0G6C08XKf3Zt7AYHf6vnV5Hkuz0JQQJ99BHACfhMk5XJ3w3AAAYACOGdnaN";
const SPEECH_REGION = "swedencentral";

interface UIElements {
  userAccessToken: HTMLInputElement | null;
  calleeAcsUserId: HTMLInputElement | null;
  initializeCallAgentButton: HTMLButtonElement | null;
  startCallButton: HTMLButtonElement | null;
  hangUpCallButton: HTMLButtonElement | null;
  acceptCallButton: HTMLButtonElement | null;
  startVideoButton: HTMLButtonElement | null;
  stopVideoButton: HTMLButtonElement | null;
  connectedLabel: HTMLElement | null;
  remoteVideosGallery: HTMLElement | null;
  localVideoContainer: HTMLElement | null;
  transcriptionTextElement: HTMLElement | null;
  callStatusIndicator: HTMLElement | null;
  speechToSpeechButton: HTMLButtonElement | null;
  speechToSpeechStatus: HTMLElement | null;
}

const els: UIElements = {
  userAccessToken: document.getElementById('user-access-token') as HTMLInputElement,
  calleeAcsUserId: document.getElementById('callee-acs-user-id') as HTMLInputElement,
  initializeCallAgentButton: document.getElementById('initialize-call-agent') as HTMLButtonElement,
  startCallButton: document.getElementById('start-call-button') as HTMLButtonElement,
  hangUpCallButton: document.getElementById('hangup-call-button') as HTMLButtonElement,
  acceptCallButton: document.getElementById('accept-call-button') as HTMLButtonElement,
  startVideoButton: document.getElementById('start-video-button') as HTMLButtonElement,
  stopVideoButton: document.getElementById('stop-video-button') as HTMLButtonElement,
  connectedLabel: document.getElementById('connectedLabel'),
  remoteVideosGallery: document.getElementById('remoteVideosGallery'),
  localVideoContainer: document.getElementById('localVideoContainer'),
  transcriptionTextElement: document.getElementById('transcription-text'),
  callStatusIndicator: document.getElementById('call-status-indicator'),
  speechToSpeechButton: document.getElementById('speech-to-speech-button') as HTMLButtonElement,
  speechToSpeechStatus: document.getElementById('speech-to-speech-status')
};

configureUI(els);
setTranscriptionElement(els.transcriptionTextElement);

function updateCallStatusIndicator(state: string){
  if(!els.callStatusIndicator) return;
  const map: Record<string,[string,string]> = {
    Connected:['📞 Chiamata Connessa','#4CAF50'],
    Connecting:['📞 Connessione in corso...','#FF9800'],
    Disconnected:['📞 Chiamata Terminata','#f44336'],
    Ringing:['📞 Squillo...','#2196F3']
  };
  const [txt,col] = map[state] || [`📞 Stato: ${state}`,'#666'];
  els.callStatusIndicator.innerHTML = `<strong style="color:${col};">${txt}</strong>`;
}

function updateTranscript(text: string, isFinal: boolean){
  const el = els.transcriptionTextElement; if(!el) return;
  el.innerHTML = isFinal ? text.replace(/\n/g,'<br>') : text;
  el.scrollTop = el.scrollHeight;
}

configurePipeline({
  subscriptionKey: SPEECH_KEY,
  region: SPEECH_REGION,
  statusElement: els.speechToSpeechStatus,
  updateTranscriptionDisplay: updateTranscript,
  setRecognizer: setRecognizer
});

async function initSpeech(){
  await initializeSpeechRecognition(SPEECH_KEY, SPEECH_REGION);
  await initializeSpeechSynthesis(SPEECH_KEY, SPEECH_REGION);
}

document.addEventListener('DOMContentLoaded', ()=>{
  els.initializeCallAgentButton && (els.initializeCallAgentButton.onclick = async ()=>{
    if(!els.userAccessToken) return;
    await initializeAgent(els.userAccessToken.value);
    if(els.startCallButton) els.startCallButton.disabled=false;
    if(els.initializeCallAgentButton) els.initializeCallAgentButton.disabled=true;
  });
  els.startCallButton && (els.startCallButton.onclick = async ()=>{ if(els.calleeAcsUserId) await startCall(els.calleeAcsUserId.value); });
  els.acceptCallButton && (els.acceptCallButton.onclick = async ()=>{ await acceptCall(); });
  els.hangUpCallButton && (els.hangUpCallButton.onclick = async ()=>{ await hangUp(); });
  els.startVideoButton && (els.startVideoButton.onclick = async ()=>{ await startVideo(); });
  els.stopVideoButton && (els.stopVideoButton.onclick = async ()=>{ await stopVideo(); });

  setHooks({
    onConnected: ()=>{
      updateCallStatusIndicator('Connected');
      if(!getSpeechConfig()) void initSpeech();
      els.speechToSpeechButton && (els.speechToSpeechButton.disabled=false);
    },
    onDisconnected: ()=>{
      updateCallStatusIndicator('Disconnected');
      els.speechToSpeechButton && (els.speechToSpeechButton.disabled=true);
    },
    onStateChanged: s => updateCallStatusIndicator(s)
  });

  els.speechToSpeechButton && (els.speechToSpeechButton.onclick = async ()=>{
    const call = getCall();
    if(!call || call.state !== 'Connected') return;
    if(pipelineActive()) await stopPipeline(); else {
      if(!getSpeechConfig()) await initSpeech();
      const audioConfig = speechSdk.AudioConfig.fromDefaultMicrophoneInput();
      const rec = new speechSdk.SpeechRecognizer(getSpeechConfig()!, audioConfig);
      setRecognizer(rec);
      rec.startContinuousRecognitionAsync(()=> startPipeline(rec), err=> console.error('Recognizer start error', err));
    }
    if(els.speechToSpeechButton)
      els.speechToSpeechButton.textContent = pipelineActive() ? '🛑 Ferma Pipeline Speech-to-Speech' : '🔄 Avvia Pipeline Speech-to-Speech';
  });

  updateCallStatusIndicator('Disconnected');
  els.speechToSpeechStatus && (els.speechToSpeechStatus.innerHTML = '<strong style="color:gray;">📞 Nessuna chiamata attiva</strong>');
});
