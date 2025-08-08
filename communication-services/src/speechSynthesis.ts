import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';

let speechConfig: speechSdk.SpeechConfig | undefined;
let speechSynthesizer: speechSdk.SpeechSynthesizer | undefined;
let voice = 'it-IT-ElsaNeural';

export const getSynthesizer = () => speechSynthesizer;
export const setVoice = (v: string) => { voice = v; if(speechConfig) speechConfig.speechSynthesisVoiceName = voice; };

export async function initializeSpeechSynthesis(key: string, region: string){
  try {
    if(!speechConfig) speechConfig = speechSdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechSynthesisLanguage='it-IT';
    speechConfig.speechSynthesisVoiceName=voice;
    if(!speechSynthesizer) speechSynthesizer = new speechSdk.SpeechSynthesizer(speechConfig);
    return true;
  } catch(e){ console.error('Init TTS error', e); return false; }
}

export const createSSML = (text: string) => `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="it-IT"><voice name="${voice}">${text}</voice></speak>`;
