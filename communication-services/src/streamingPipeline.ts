import * as speechSdk from 'microsoft-cognitiveservices-speech-sdk';
import { createSSML, getSynthesizer, initializeSpeechSynthesis } from './speechSynthesis';
import { getTranscriptionText } from './speechRecognition';

interface PipelineConfig { subscriptionKey: string; region: string; statusElement?: HTMLElement | null; updateTranscriptionDisplay: (text: string, isFinal: boolean) => void; setRecognizer: (r: any) => void; }

let subscriptionKey: string; let region: string; let speechRecognizer: speechSdk.SpeechRecognizer | undefined;
let partialTextBuffer=''; let synthesisQueue: string[]=[]; let isSynthesisInProgress=false; let minWordsForSynthesis=3; let lastPartialText=''; let hasSynthesizedAnything=false;
let active=false; let statusEl: HTMLElement | null | undefined; let updateTranscriptionDisplay: (t:string,f:boolean)=>void; let setRecognizerCallback: (r:any)=>void;

export function configure(cfg: PipelineConfig){ subscriptionKey=cfg.subscriptionKey; region=cfg.region; statusEl=cfg.statusElement; updateTranscriptionDisplay=cfg.updateTranscriptionDisplay; setRecognizerCallback=cfg.setRecognizer; }
export function setRecognizer(r: speechSdk.SpeechRecognizer){ speechRecognizer=r; }
export const isActive = () => active;

function status(msg: string, color: string){ if(statusEl) statusEl.innerHTML = `<strong style="color:${color};">${msg}</strong>`; const btn=document.getElementById('speech-to-speech-button'); if(btn) btn.textContent = active ? '🛑 Ferma Pipeline Speech-to-Speech' : '🔄 Avvia Pipeline Speech-to-Speech'; }
export function resetStreamingState(){ partialTextBuffer=''; synthesisQueue=[]; isSynthesisInProgress=false; lastPartialText=''; hasSynthesizedAnything=false; }

export async function startPipeline(recognizer: speechSdk.SpeechRecognizer){ speechRecognizer=recognizer; if(!speechRecognizer) throw new Error('Recognizer mancante'); resetStreamingState(); active=true; status('🔄 Pipeline Avvio...','orange'); wire(); status('🔄 Pipeline Attiva - Parla!','green'); }
export async function stopPipeline(){ active=false; resetStreamingState(); status('🛑 Pipeline Fermata','gray'); }

function wire(){ if(!speechRecognizer) return; speechRecognizer.recognizing = async (_:unknown,e:speechSdk.SpeechRecognitionEventArgs)=>{ const t=e.result.text; updateTranscriptionDisplay(`[Pipeline] ${t}`, false); if(active && t.trim()) await handle(t); }; speechRecognizer.recognized = async (_:unknown,e:speechSdk.SpeechRecognitionEventArgs)=>{ if(e.result.reason===speechSdk.ResultReason.RecognizedSpeech){ const finalText=e.result.text.trim(); if(finalText && active){ const current=getTranscriptionText(); updateTranscriptionDisplay(current + `[TU]: ${finalText} `, true); await finalize(finalText); status('🔄 Pipeline Attiva - Parla!','green'); } } }; speechRecognizer.canceled = (_:unknown,e:speechSdk.SpeechRecognitionCanceledEventArgs)=>{ if(e.reason===speechSdk.CancellationReason.Error){ status(`❌ Errore: ${e.errorDetails}`,'red'); active=false; } }; speechRecognizer.sessionStopped=()=>{ active=false; resetStreamingState(); }; }

function stable(currentText: string, previousText: string){ if(!previousText) return ''; const cur=currentText.trim().split(/\s+/); const prev=previousText.trim().split(/\s+/); const out:string[]=[]; const len=Math.min(cur.length,prev.length); for(let i=0;i<len-1;i++){ if(cur[i]===prev[i]) out.push(cur[i]); else break; } return out.join(' '); }

async function handle(partial: string){ const s=stable(partial,lastPartialText); lastPartialText=partial; const list=s.trim().split(/\s+/).filter(Boolean); if(!list.length) return; if(!partialTextBuffer && list.length>=minWordsForSynthesis){ partialTextBuffer=s.trim(); await synth(partialTextBuffer); hasSynthesizedAnything=true; return; } if(partialTextBuffer){ const current=partialTextBuffer.trim().split(/\s+/); if(list.length>current.length){ const add=list.slice(current.length); if(add.length){ partialTextBuffer=s.trim(); const addText=add.join(' '); if(!isSynthesisInProgress){ await synth(addText); hasSynthesizedAnything=true; } else synthesisQueue.push(addText); } } } }

async function synth(text: string){ if(!text.trim()) return false; if(isSynthesisInProgress){ synthesisQueue.push(text); return true; } if(!getSynthesizer()) await initializeSpeechSynthesis(subscriptionKey, region); isSynthesisInProgress=true; const ssml=createSSML(text); return await new Promise<boolean>((resolve,reject)=>{ getSynthesizer()!.speakSsmlAsync(ssml, async r=>{ isSynthesisInProgress=false; if(r.reason===speechSdk.ResultReason.SynthesizingAudioCompleted){ if(synthesisQueue.length){ const n=synthesisQueue.shift()!; await synth(n); } resolve(true); } else reject(new Error(r.errorDetails)); }, err=>{ isSynthesisInProgress=false; reject(err); }); }); }

async function finalize(finalText: string){ if(!finalText.trim()){ resetStreamingState(); return; } if(!hasSynthesizedAnything){ await synth(finalText); resetStreamingState(); return; } if(!partialTextBuffer){ resetStreamingState(); return; } const finalWords=finalText.split(/\s+/).filter(Boolean); const processed=partialTextBuffer.split(/\s+/).filter(Boolean); let i=0; while(i<Math.min(finalWords.length,processed.length)&& finalWords[i].toLowerCase()===processed[i].toLowerCase()) i++; const remaining=finalWords.slice(i); if(remaining.length) await synth(remaining.join(' ')); resetStreamingState(); }
