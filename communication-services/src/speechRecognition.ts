import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';

let speechConfig: speechSdk.SpeechConfig | undefined;
let speechRecognizer: speechSdk.SpeechRecognizer | undefined;
let transcriptionText = '';
let isActive = false;
let transcriptionEl: HTMLElement | null | undefined;

export const setTranscriptionElement = (el: HTMLElement | null) => { transcriptionEl = el; };
export const getTranscriptionText = () => transcriptionText;
export const getSpeechConfig = () => speechConfig;

export async function initializeSpeechRecognition(key: string, region: string){
  try { speechConfig = speechSdk.SpeechConfig.fromSubscription(key, region); speechConfig.speechRecognitionLanguage='it-IT'; return true; }
  catch(e){ console.error('Init STT error', e); return false; }
}

function createRecognizer(){
  try { return new speechSdk.SpeechRecognizer(speechConfig!, speechSdk.AudioConfig.fromDefaultMicrophoneInput()); }
  catch(e){ console.error('Create recognizer error', e); return undefined; }
}

function render(text: string, final: boolean){ if(!transcriptionEl) return; transcriptionEl.innerHTML = final ? text.replace(/\n/g,'<br>') : text; transcriptionEl.scrollTop = transcriptionEl.scrollHeight; }

function wireEvents(){
  if(!speechRecognizer) return;
  speechRecognizer.recognizing = (_,_e: any) => render(`[Riconoscendo...] ${_e.result.text}`, false);
  speechRecognizer.recognized = (_,_e: any) => {
    if(_e.result.reason === speechSdk.ResultReason.RecognizedSpeech){
      const t = _e.result.text.trim(); if(t){ transcriptionText += t + ' '; render(transcriptionText, true); }
    }
  };
  speechRecognizer.canceled = (_,_e: any) => { if(_e.reason === speechSdk.CancellationReason.Error) render(`❌ Errore: ${_e.errorDetails}`, true); };
  speechRecognizer.sessionStopped = ()=>{ isActive=false; };
}

export async function startSpeechRecognition(){
  try {
    if(speechRecognizer) await stopSpeechRecognition();
    if(!speechConfig) throw new Error('SpeechConfig mancante');
    speechRecognizer = createRecognizer();
    if(!speechRecognizer) throw new Error('Creazione recognizer fallita');
    wireEvents(); transcriptionText=''; render('🎤 Riconoscimento vocale attivo... Inizia a parlare!', true);
    return await new Promise<boolean>(res => { speechRecognizer!.startContinuousRecognitionAsync(()=>{ isActive=true; res(true); }, err=>{ console.error(err); isActive=false; res(false); }); });
  } catch(e){ console.error('Start STT error', e); return false; }
}

export async function stopSpeechRecognition(){
  if(!speechRecognizer) return;
  return await new Promise<boolean>(res => { speechRecognizer!.stopContinuousRecognitionAsync(()=>{ try { speechRecognizer!.close(); } catch{} speechRecognizer=undefined; isActive=false; res(true); }, err=>{ console.error(err); try { speechRecognizer!.close(); } catch{} speechRecognizer=undefined; isActive=false; res(false); }); });
}
