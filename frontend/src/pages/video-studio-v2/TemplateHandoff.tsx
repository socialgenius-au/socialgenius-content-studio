import { useState } from 'react'
import { useStudio } from '../../contexts/StudioContext'
type Scene={id:string;duration:number;headline:string;caption:string;transition:string}
type Handoff={title:string;scenes:Scene[]}
const KEY='sg-video-template-handoff'
export default function TemplateHandoff(){
 const {addTextOverlay,setTimeline,setCanvasFormat,textOverlays,videoClips}=useStudio()
 const [pending,setPending]=useState(()=>{try{const x=sessionStorage.getItem(KEY);if(!x)return null;const v=JSON.parse(x) as Handoff;return Array.isArray(v.scenes)&&v.scenes.length>0&&v.scenes.length<=20?v:null}catch{return null}})
 if(!pending)return null
 const apply=()=>{
  if((textOverlays.length||videoClips.length)&&!window.confirm('This will add template text overlays to your existing project without deleting your clips. Continue?'))return
  let start=0
  for(const s of pending.scenes){const duration=Math.max(2,Math.min(30,Number(s.duration)||5));for(const [n,txt] of [s.headline,s.caption].entries()){if(typeof txt!=='string'||!txt.trim())continue;addTextOverlay({id:'starter-'+Date.now()+'-'+start+'-'+n,text:txt.slice(0,180),x:10,y:n?68:35,width:80,startTime:start,endTime:start+duration,fontFamily:'Inter',fontSize:n?32:58,bold:!n,italic:false,color:'#FFFFFF',bgColor:'#20152e',bgOpacity:.35,animation:'fade_in'})}start+=duration}
  setTimeline({duration:Math.max(start,0)})
  setCanvasFormat({platformKey:'instagram',placementKey:'reel_story',label:'Instagram - Reel / Story',ratio:'9:16',width:1080,height:1920})
  sessionStorage.removeItem(KEY);setPending(null)
 }
 return <div role="region" aria-label="Video starter template import" style={{padding:14,background:'#fff6dd',border:'1px solid #cda458',borderRadius:10,margin:12,color:'#3d2d1b'}}><strong>Video starter ready: {pending.title}</strong><p style={{fontSize:13,margin:'6px 0'}}>Import {pending.scenes.length} timed scenes as editable text overlays in the Video Studio timeline. Video placeholders are not rendered media; upload your own licensed clips in the editor. Existing project clips will not be deleted.</p><div style={{display:'flex',gap:8}}><button type="button" onClick={apply} style={{background:'#654185',color:'white',padding:9,borderRadius:7}}>Import text and timings</button><button type="button" onClick={()=>{sessionStorage.removeItem(KEY);setPending(null)}}>Discard</button></div></div>
}
