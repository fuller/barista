import type {buildVoicePreview} from '../application/voice-preview.mjs';
type Props={transcript:string;preparing:boolean;preview:ReturnType<typeof buildVoicePreview>};
/** A separate hypothetical order: no totals, actions, or confirmation controls. */
export function VoicePreview({transcript,preparing,preview}:Props){
 if(!transcript)return null;
 return <aside className="voice-preview" aria-label="Voice order preview">
  <div className="voice-preview-title"><span>Hearing you</span><span>Preview</span></div>
  <p className="voice-transcript" dir="auto">{transcript}</p>
  {preview&&<div className="voice-preview-items">{preview.items.map(item=><div key={item.id}><h3>{item.quantity>1?`${item.quantity} × `:''}{item.name}</h3><p>{item.size??'Default size'}{item.instructions.length>0?' · '+item.instructions.join(' · '):''}</p></div>)}{!preview.items.length&&<p>Your order would be empty.</p>}{preview.confirmed&&<p>This would confirm your order.</p>}</div>}
  <p className="voice-preview-help">{preparing?'Preparing your order…':'Your cart updates when you finish speaking.'}</p>
 </aside>;
}
