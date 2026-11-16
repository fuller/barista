export interface VoiceInput { supported: boolean; start():void; finish():void; stop():void; dispose():void }
export type VoiceTimingEvent = 'recognitionStart'|'audioStart'|'speechEnd'|'finalTranscript';
export interface VoiceCallbacks { onTiming?(event:VoiceTimingEvent):void; onTranscript(text:string):void; onState(listening:boolean):void; onError(message:string):void }
interface RecognitionEvent { results: ArrayLike<{isFinal:boolean; [index:number]:{transcript:string}}> }
interface Recognition { lang:string; continuous:boolean; interimResults:boolean; onaudiostart:(()=>void)|null; onspeechend:(()=>void)|null; onresult:((e:RecognitionEvent)=>void)|null; onend:(()=>void)|null; onerror:((e:{error:string})=>void)|null; start():void; stop():void; abort():void }
export function createVoiceInput(callbacks:VoiceCallbacks):VoiceInput {
  const scope=window as unknown as {SpeechRecognition?:new()=>Recognition; webkitSpeechRecognition?:new()=>Recognition};
  const Constructor=scope.SpeechRecognition||scope.webkitSpeechRecognition;
  let recognition:Recognition|null=null, session=0, disposed=false, finishing=false;
  return {supported:!!Constructor,start(){
    if(!Constructor||disposed){callbacks.onError('Speech recognition is unavailable. You can type your order.');return;}
    const currentSession=++session; recognition?.abort();finishing=false; let delivered=false,failed=false;
    recognition=new Constructor(); recognition.lang='en-US'; recognition.continuous=false; recognition.interimResults=false;
    const timing=(event:VoiceTimingEvent)=>{if(!disposed&&session===currentSession)callbacks.onTiming?.(event);};
    recognition.onaudiostart=()=>timing('audioStart');recognition.onspeechend=()=>timing('speechEnd');
    recognition.onresult=e=>{if(delivered||disposed||session!==currentSession)return; let transcript=''; for(let i=0;i<e.results.length;i++)if(e.results[i].isFinal)transcript+=e.results[i][0].transcript+' '; if(transcript.trim()){delivered=true;timing('finalTranscript');callbacks.onTranscript(transcript.trim());}};
    recognition.onend=()=>{if(!disposed&&session===currentSession){callbacks.onState(false);if(!delivered&&!failed){failed=true;callbacks.onError('I didn’t catch any speech. Try the microphone again, or type your order.');}}};
    recognition.onerror=e=>{if(!disposed&&session===currentSession){failed=true;callbacks.onState(false);callbacks.onError(e.error==='not-allowed'?'Microphone permission was denied. Type your order below.':e.error==='network'?'The browser speech service could not connect. Try again, or type your order.':e.error==='no-speech'?'I didn’t catch any speech. Try the microphone again, or type your order.':`Voice stopped (${e.error}). You can type instead.`);}};
    try {timing('recognitionStart');recognition.start();callbacks.onState(true);}catch{callbacks.onState(false);callbacks.onError('Could not start the microphone. Try typing your order.');}
  },finish(){if(!disposed&&recognition&&!finishing)try{finishing=true;recognition.stop();}catch{callbacks.onError('Could not finish speech. Try typing your order.');}},stop(){session++;recognition?.abort();callbacks.onState(false);},dispose(){disposed=true;session++;recognition?.abort();recognition=null;}};
}
export function createVoiceOutput(){return {supported:'speechSynthesis' in window,speak(text:string){if(!('speechSynthesis' in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';window.speechSynthesis.speak(utterance);},stop(){if('speechSynthesis' in window)window.speechSynthesis.cancel();}};}
