import { useEffect, useRef } from 'react'
import { assetsApi, videoStudioDraftsApi, videoExportApi, uploadApi } from '../../api/client'
import editorHtml from '../../../../ui-v3/index.html?raw'
export default function VideoStudioV3() {
 const frame = useRef<HTMLIFrameElement>(null)
 useEffect(() => {
  let disposed = false
  let v3DraftId: number | null = null
  const receive = async (event: MessageEvent) => {
   if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
   const target = frame.current?.contentWindow
   if (event.data?.type === 'sg-v3-export') {
    const reply = (message: string) => target?.postMessage({type:'sg-v3-export-result',message},window.location.origin)
    try {
     const { clips, width, height, texts = [] } = event.data
     if (!Array.isArray(clips)||!clips.length||clips.length>100||![1080,1920].includes(width)||![1080,1920].includes(height)) throw Error('Invalid export project')
     if (!Array.isArray(texts)||texts.length>2||texts.some(t=>typeof t.text!=='string'||t.text.length>4000||![t.start_time,t.end_time,t.x,t.y,t.font_size].every(Number.isFinite)||t.start_time<0||t.end_time<=t.start_time)) throw Error('Invalid text layers')
     const video = [], audio = []
     for (const clip of clips) {
      if (!['video','audio'].includes(clip.kind)||!Number.isFinite(clip.start)||!Number.isFinite(clip.duration)||clip.start<0||clip.duration<=0) throw Error('Unsupported clip')
      let id = Number(clip.serverId)
      if (!Number.isSafeInteger(id)||id<=0) {
       if (!(clip.blob instanceof Blob)) throw Error('Missing media')
       const uploaded = await uploadApi.upload(new File([clip.blob],String(clip.name),{type:clip.blob.type}))
       id = uploaded.data.id
      }
      const item = {asset_id:id,start_time:clip.start,end_time:clip.start+clip.duration,trim_in:0,volume:clip.muted?0:1}
      if(clip.kind==='video') video.push({...item,muted:!!clip.muted,speed:1,fit_mode:'fit'})
      else audio.push(item)
     }
     if(!video.length) throw Error('Add video first')
     video.sort((a,b)=>a.start_time-b.start_time)
     if(video.some((v,i)=>Math.abs(v.start_time-(i?video[i-1].end_time:0))>0.05)) throw Error('Video gaps or overlaps are not supported by this export adapter')
     const result = await videoExportApi.exportProject({canvas_width:width,canvas_height:height,video_clips:video,audio_tracks:audio,text_overlays:texts,media_overlays:[]})
     const url=URL.createObjectURL(result.data)
     const link=document.createElement('a');link.href=url;link.download='social-genius-v3.mp4';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
     reply('MP4 rendered — check downloads')
    } catch(e) {reply(e instanceof Error?e.message:'Export failed')}
    return
   }
   if (event.data?.type === 'sg-v3-save-server') {
    try {
     const draft = event.data.draft
     if (draft?.version !== 1 || !Array.isArray(draft.clips)) throw Error('Invalid draft')
     const body = { name: 'V3 · '+String(draft.title).slice(0,100), project_json: { editor_version: 3, draft } }
     const result = v3DraftId === null ? await videoStudioDraftsApi.create(body) : await videoStudioDraftsApi.update(v3DraftId,body)
     v3DraftId = result.data.id
     target?.postMessage({type:'sg-v3-server-result',message:'Server draft '+v3DraftId+' saved; local media remain on this browser'},window.location.origin)
    } catch { target?.postMessage({type:'sg-v3-server-result',message:'Server save failed'},window.location.origin) }
    return
   }
   if (event.data?.type === 'sg-v3-open-server') {
    try {
     const id = Number(event.data.id)
     if (!Number.isSafeInteger(id)||id<=0) throw Error('Invalid draft ID')
     const result = await videoStudioDraftsApi.get(id)
     if (result.data.project_json?.editor_version !== 3) throw Error('Not a V3 draft')
     v3DraftId = id
     target?.postMessage({type:'sg-v3-server-result',draft:result.data.project_json.draft,message:'V3 server draft loaded'},window.location.origin)
    } catch { target?.postMessage({type:'sg-v3-server-result',message:'V3 draft unavailable'},window.location.origin) }
    return
   }
   if(event.data?.type !== 'sg-v3-import-assets') return
   try {
    const review = JSON.parse(sessionStorage.getItem('sg-reconstructor-asset-finder-v1') || '{}')
    const selections = Array.isArray(review.selected) ? review.selected : []
    const assets = []
    for (const item of selections.slice(0, 30)) {
     if (!Number.isSafeInteger(item.assetId) || item.assetId <= 0) continue
     try {
      const response = await assetsApi.download(item.assetId)
      assets.push({ id: item.assetId, name: String(item.title || 'Asset'), scene: item.scene, kind: item.type === 'images' ? 'image' : item.type === 'videos' ? 'video' : 'audio', blob: response.data })
     } catch { /* inaccessible assets remain unimported */ }
    }
    if (!disposed) target?.postMessage({type:'sg-v3-assets-result',assets,requested:selections.length},window.location.origin)
   } catch { if (!disposed) target?.postMessage({type:'sg-v3-assets-result',assets:[],requested:0,error:true},window.location.origin) }
  }
  window.addEventListener('message',receive)
  return () => { disposed = true; window.removeEventListener('message',receive) }
 },[])
 return <iframe ref={frame} title="Video Studio V3" srcDoc={editorHtml} style={{border:0,width:'100%',height:'100dvh',display:'block'}} />
}
