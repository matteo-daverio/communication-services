import { CallClient, VideoStreamRenderer, LocalVideoStream } from '@azure/communication-calling';
import { AzureCommunicationTokenCredential } from '@azure/communication-common';

type CallLike = any; type RemoteParticipantLike = any; type RemoteVideoStreamLike = any;

export interface UIElements { acceptCallButton?: HTMLButtonElement | null; startCallButton?: HTMLButtonElement | null; hangUpCallButton?: HTMLButtonElement | null; startVideoButton?: HTMLButtonElement | null; stopVideoButton?: HTMLButtonElement | null; connectedLabel?: HTMLElement | null; remoteVideosGallery?: HTMLElement | null; localVideoContainer?: HTMLElement | null; speechToSpeechButton?: HTMLButtonElement | null; }
export interface CallHooks { onConnected?: () => void; onDisconnected?: () => void; onStateChanged?: (state: string) => void; }

let callAgent: any; let deviceManager: any; let call: CallLike | undefined; let incomingCall: any; let localVideoStream: any; let localVideoStreamRenderer: any; let ui: UIElements = {}; let hooks: CallHooks = {};

export const configureUI = (elements: UIElements) => { ui = elements; };
export const setHooks = (h: CallHooks) => { hooks = { ...hooks, ...h }; };
export const getCall = () => call;

export async function initializeAgent(token: string){
  const callClient = new CallClient();
  const tokenCredential = new AzureCommunicationTokenCredential(token.trim());
  callAgent = await callClient.createCallAgent(tokenCredential);
  deviceManager = await callClient.getDeviceManager();
  await deviceManager.askDevicePermission({ video: true, audio: true });
  callAgent.on('incomingCall', (args: any) => {
    incomingCall = args.incomingCall;
    ui.acceptCallButton && (ui.acceptCallButton.disabled = false);
    ui.startCallButton && (ui.startCallButton.disabled = true);
  });
}

export async function startCall(callee: string){
  const lvs = await createLocalVideoStream();
  const videoOptions = lvs ? { localVideoStreams: [lvs] } : undefined;
  call = callAgent.startCall([{ communicationUserId: callee.trim() }], { videoOptions });
  subscribeToCall(call);
}

export async function acceptCall(){
  const lvs = await createLocalVideoStream();
  const videoOptions = lvs ? { localVideoStreams: [lvs] } : undefined;
  call = await incomingCall.accept({ videoOptions });
  subscribeToCall(call);
}

export function subscribeToCall(c: CallLike){
  c.on('stateChanged', async () => {
    const s = c.state;
    if(s === 'Connected'){
      ui.connectedLabel && (ui.connectedLabel.hidden = false);
      ui.acceptCallButton && (ui.acceptCallButton.disabled = true);
      ui.startCallButton && (ui.startCallButton.disabled = true);
      ui.hangUpCallButton && (ui.hangUpCallButton.disabled = false);
      ui.startVideoButton && (ui.startVideoButton.disabled = false);
      ui.stopVideoButton && (ui.stopVideoButton.disabled = false);
      ui.remoteVideosGallery && (ui.remoteVideosGallery.hidden = false);
      ui.localVideoContainer && (ui.localVideoContainer.hidden = false);
      ui.speechToSpeechButton && (ui.speechToSpeechButton.disabled = false);
      hooks.onConnected && hooks.onConnected();
    } else if(s === 'Disconnected'){
      ui.connectedLabel && (ui.connectedLabel.hidden = true);
      ui.startCallButton && (ui.startCallButton.disabled = false);
      ui.hangUpCallButton && (ui.hangUpCallButton.disabled = true);
      ui.startVideoButton && (ui.startVideoButton.disabled = true);
      ui.stopVideoButton && (ui.stopVideoButton.disabled = true);
      ui.speechToSpeechButton && (ui.speechToSpeechButton.disabled = true);
      hooks.onDisconnected && hooks.onDisconnected();
    }
    hooks.onStateChanged && hooks.onStateChanged(s);
  });

  c.localVideoStreams && c.localVideoStreams.forEach(async (lvs: any) => { localVideoStream = lvs; await displayLocalVideoStream(); });
  c.on('localVideoStreamsUpdated', (e: any) => {
    e.added.forEach(async (lvs: any) => { localVideoStream = lvs; await displayLocalVideoStream(); });
    e.removed.forEach(() => removeLocalVideoStream());
  });

  c.remoteParticipants.forEach((rp: any) => subscribeToRemoteParticipant(rp));
  c.on('remoteParticipantsUpdated', (e: any) => { e.added.forEach((rp: any) => subscribeToRemoteParticipant(rp)); });
}

function subscribeToRemoteParticipant(rp: RemoteParticipantLike){
  rp.videoStreams.forEach((vs: any) => subscribeToRemoteVideoStream(vs));
  rp.on('videoStreamsUpdated', (e: any) => { e.added.forEach((vs: any) => subscribeToRemoteVideoStream(vs)); });
}

async function subscribeToRemoteVideoStream(remoteVideoStream: RemoteVideoStreamLike){
  const renderer = new VideoStreamRenderer(remoteVideoStream);
  let view: any;
  const container = document.createElement('div');
  container.className = 'remote-video-container';
  const createView = async () => { view = await renderer.createView(); container.appendChild(view.target); ui.remoteVideosGallery && ui.remoteVideosGallery.appendChild(container); };
  remoteVideoStream.on('isAvailableChanged', async () => { if(remoteVideoStream.isAvailable) await createView(); else if(view){ view.dispose(); ui.remoteVideosGallery && ui.remoteVideosGallery.removeChild(container); } });
  if(remoteVideoStream.isAvailable) await createView();
}

async function createLocalVideoStream(){
  const cameras = await deviceManager.getCameras();
  const cam = cameras[0];
  if(cam) return new LocalVideoStream(cam);
  console.error('Nessuna camera trovata');
}

async function displayLocalVideoStream(){
  if(!localVideoStream) return;
  if(localVideoStreamRenderer){ try { localVideoStreamRenderer.dispose(); } catch {} }
  localVideoStreamRenderer = new VideoStreamRenderer(localVideoStream);
  const view = await localVideoStreamRenderer.createView();
  if(ui.localVideoContainer){
    ui.localVideoContainer.hidden = false;
    while(ui.localVideoContainer.firstChild) ui.localVideoContainer.removeChild(ui.localVideoContainer.firstChild);
    ui.localVideoContainer.appendChild(view.target);
  }
}

function removeLocalVideoStream(){
  if(localVideoStreamRenderer){ try { localVideoStreamRenderer.dispose(); } catch {} }
  ui.localVideoContainer && (ui.localVideoContainer.hidden = true);
}

export async function startVideo(){
  if(!call) return;
  try {
    if(call.localVideoStreams && call.localVideoStreams.length > 0) return;
    if(!localVideoStream) localVideoStream = await createLocalVideoStream();
    if(localVideoStream) await call.startVideo(localVideoStream);
  } catch(e){ console.error('Errore startVideo', e); }
}

export async function stopVideo(){
  if(!call) return;
  try {
    if(!(call.localVideoStreams && call.localVideoStreams.length > 0)) return;
    if(localVideoStream) await call.stopVideo(localVideoStream);
    removeLocalVideoStream();
    localVideoStream = undefined;
  } catch(e){ console.error('Errore stopVideo', e); }
}

export async function hangUp(){ if(call) await call.hangUp(); }
