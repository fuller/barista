export interface VoiceInput { supported: boolean; start():void; finish():void; stop():void; dispose():void }
export type VoiceTimingEvent = 'recognitionStart'|'audioStart'|'speechStart'|'speechEnd'|'interimTranscript'|'finalTranscript';
export interface VoiceCallbacks { onTiming?(event:VoiceTimingEvent):void; onInterimTranscript?(text:string):void; onTranscript(text:string):void; onState(listening:boolean):void; onError(message:string):void }
interface RecognitionEvent { results: ArrayLike<{isFinal:boolean; [index:number]:{transcript:string}}> }
interface Recognition { lang:string; continuous:boolean; interimResults:boolean; onaudiostart:(()=>void)|null; onspeechstart:(()=>void)|null; onspeechend:(()=>void)|null; onresult:((e:RecognitionEvent)=>void)|null; onend:(()=>void)|null; onerror:((e:{error:string})=>void)|null; start():void; stop():void; abort():void }
export function createVoiceInput(callbacks:VoiceCallbacks):VoiceInput {
  const scope=window as unknown as {SpeechRecognition?:new()=>Recognition; webkitSpeechRecognition?:new()=>Recognition};
  const Constructor=scope.SpeechRecognition||scope.webkitSpeechRecognition;
  let recognition:Recognition|null=null, session=0, disposed=false, finishing=false;
  return {supported:!!Constructor,start(){
    if(!Constructor||disposed){callbacks.onError('Speech recognition is unavailable. You can type your order.');return;}
    const currentSession=++session; recognition?.abort();finishing=false; let delivered=false,failed=false;
    recognition=new Constructor(); recognition.lang='en-US'; recognition.continuous=false; recognition.interimResults=true;
    const timing=(event:VoiceTimingEvent)=>{if(!disposed&&session===currentSession)callbacks.onTiming?.(event);};
    recognition.onaudiostart=()=>timing('audioStart');recognition.onspeechstart=()=>timing('speechStart');recognition.onspeechend=()=>timing('speechEnd');
    recognition.onresult=e=>{
      if(delivered||failed||disposed||session!==currentSession)return;
      let transcript='',interim=false;
      for(let i=0;i<e.results.length;i++){transcript+=e.results[i][0].transcript+' ';if(!e.results[i].isFinal)interim=true;}
      transcript=transcript.trim();if(!transcript){callbacks.onInterimTranscript?.('');return;}
      if(interim){timing('interimTranscript');callbacks.onInterimTranscript?.(transcript);return;}
      delivered=true;timing('finalTranscript');callbacks.onTranscript(transcript);
    };
    recognition.onend=()=>{if(!disposed&&session===currentSession){session++;callbacks.onState(false);if(!delivered&&!failed){failed=true;callbacks.onError('I didn’t catch any speech. Try the microphone again, or type your order.');}}};
    recognition.onerror=e=>{if(!disposed&&session===currentSession){failed=true;session++;try{recognition?.abort();}catch{                                                                   }callbacks.onState(false);callbacks.onError(e.error==='not-allowed'?'Microphone permission was denied. Type your order below.':e.error==='network'?'The browser speech service could not connect. Try again, or type your order.':e.error==='no-speech'?'I didn’t catch any speech. Try the microphone again, or type your order.':`Voice stopped (${e.error}). You can type instead.`);}};
    try {timing('recognitionStart');recognition.start();callbacks.onState(true);}catch{failed=true;session++;callbacks.onState(false);callbacks.onError('Could not start the microphone. Try typing your order.');}
  },finish(){if(!disposed&&recognition&&!finishing)try{finishing=true;recognition.stop();}catch{callbacks.onError('Could not finish speech. Try typing your order.');}},stop(){session++;recognition?.abort();callbacks.onState(false);},dispose(){disposed=true;session++;recognition?.abort();recognition=null;}};
}
export function createVoiceOutput(){return {supported:'speechSynthesis' in window,speak(text:string){if(!('speechSynthesis' in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';window.speechSynthesis.speak(utterance);},stop(){if('speechSynthesis' in window)window.speechSynthesis.cancel();}};}
