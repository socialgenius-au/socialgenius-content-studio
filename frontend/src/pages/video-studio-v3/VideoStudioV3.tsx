import { videoScenePresets } from '../../components/videoTemplatePresets'
import { useEffect, useRef } from 'react'
import { referenceVideosApi, assetsApi, brandKitsApi, generateApi, videoStudioDraftsApi, videoExportApi, uploadApi } from '../../api/client'
import editorHtml from '../../../../ui-v3/index.html?raw'
type ExportMedia = {
 asset_id: number
 start_time: number
 end_time: number
 trim_in: number
 volume: number
 fade_in?: number
 fade_out?: number
}

type ExportVideo = ExportMedia & { muted: boolean; speed: number; fit_mode: 'fit' | 'fill'; crop_x: number; crop_y: number; contrast: number; saturation: number; transition?: string; transition_duration?: number; insert_x?: number; insert_y?: number; insert_width?: number; insert_height?: number }

export default function VideoStudioV3() {
 const frame = useRef<HTMLIFrameElement>(null)
 useEffect(() => {
  let disposed = false
  let v3DraftId: number | null = null
  let draftRequestPending = false
  const receive = async (event: MessageEvent) => {
   if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
   const target = frame.current?.contentWindow

   if (event.data?.type === 'sg-v3-radiant-demo') {
    const sources = [
     {id:8131889,name:'Serum application'},
     {id:6810360,name:'Radiant skin cream'},
     {id:6750889,name:'Spa skincare ritual'},
     {id:6940609,name:'Facial mask treatment'},
    ]
    for (const source of sources) {
     try {
      const {data: imported} = await referenceVideosApi.importPublished('https://www.pexels.com/video/'+source.id+'/')
      const ref = imported.reference ?? imported
      const assetId = Number(ref.asset_id ?? imported.asset_id)
      if (!Number.isSafeInteger(assetId) || assetId <= 0) throw Error('Missing imported asset')
      const {data:blob} = await assetsApi.download(assetId)
      if (!disposed) target?.postMessage({type:'sg-v3-radiant-media',id:assetId,name:source.name,kind:'video',blob},window.location.origin)
      const video = document.createElement('video')
      const url = URL.createObjectURL(blob)
      try {
       video.muted = true; video.preload = 'auto'; video.src = url
       await new Promise<void>((resolve,reject)=>{
        const timer = window.setTimeout(()=>reject(Error('Still decode timeout')),12000)
        video.onloadeddata=()=>{clearTimeout(timer);resolve()}
        video.onerror=()=>{clearTimeout(timer);reject(Error('Still decode failed'))}
       })
       const canvas = document.createElement('canvas')
       canvas.width = video.videoWidth; canvas.height = video.videoHeight
       const ctx = canvas.getContext('2d')
       if (!ctx || !canvas.width || !canvas.height) throw Error('Invalid still')
       ctx.drawImage(video,0,0)
       const still = await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92))
       if (!still) throw Error('Still unavailable')
       const name = source.name+' — campaign still.jpg'
       const {data: uploaded} = await uploadApi.upload(new File([still],name,{type:'image/jpeg'}))
       if (!disposed) target?.postMessage({type:'sg-v3-radiant-media',id:uploaded.id,name,kind:'image',blob:still},window.location.origin)
      } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url)}
     } catch { if (!disposed) target?.postMessage({type:'sg-v3-radiant-error',name:source.name},window.location.origin) }
    }
    // Extract real stills from successfully imported footage, then persist them through the existing upload API.
    if (!disposed) target?.postMessage({type:'sg-v3-radiant-done'},window.location.origin)
    return
   }
   if (event.data?.type === 'sg-v3-presets') {
    target?.postMessage({type:'sg-v3-preset-list',presets:videoScenePresets},window.location.origin)
    return
   }
   if (event.data?.type === 'sg-v3-brand-kits') {
    try {
     const { data } = await brandKitsApi.list()
     const kits = (Array.isArray(data) ? data : []).map((item: {name: string; primary?: string}) => ({name:item.name,color:item.primary}))
     target?.postMessage({type:'sg-v3-brand-kit-list',kits},window.location.origin)
    } catch {
     target?.postMessage({type:'sg-v3-brand-kit-list',kits:[],error:true},window.location.origin)
    }
    return
   }
   if (event.data?.type === 'sg-v3-ai') {
    const prompt = typeof event.data.prompt === 'string' ? event.data.prompt.trim().slice(0, 2000) : ''
    if (!prompt) return
    try {
     const { data } = await generateApi.chat({ prompt, context: { workspace: 'Video Studio V3', title: String(event.data.title).slice(0, 100) } })
     target?.postMessage({type:'sg-v3-ai-result',content:String(data.content)},window.location.origin)
    } catch {
     target?.postMessage({type:'sg-v3-ai-result',content:'The assistant could not respond. Check the acceptance AI configuration.'},window.location.origin)
    }
    return
   }
   if (event.data?.type === 'sg-v3-library') {
    try {
     const response = await assetsApi.list()
     const rows = Array.isArray(response.data) ? response.data : response.data.items
     const assets = (Array.isArray(rows) ? rows : []).slice(0,100).map((a: any)=>({id:a.id,name:a.original_filename || a.filename || a.file_name || String(a.file_path || '').split('/').pop(),kind:String(a.file_type || '').split('/')[0]})).filter((a: any)=>Number.isSafeInteger(a.id)&&['video','image','audio'].includes(a.kind))
     target?.postMessage({type:'sg-v3-library-result',assets},window.location.origin)
    } catch {target?.postMessage({type:'sg-v3-library-result',error:true},window.location.origin)}
    return
   }
   if (event.data?.type === 'sg-v3-upload') {
    const file = event.data.file
    try {
     if (!(file instanceof File)) throw new Error('Invalid file')
     const { data } = await uploadApi.upload(file)
     target?.postMessage({type:'sg-v3-upload-result', asset: {
      id: data.id, name: data.original_filename, kind: file.type.split("/")[0],
     }, file}, window.location.origin)
    } catch {
     target?.postMessage({type:'sg-v3-upload-result', error:true}, window.location.origin)
    }
    return
   }
   if (event.data?.type === 'sg-v3-library-download') {
    const id=Number(event.data.id)
    try {
     if(!Number.isSafeInteger(id)||id<=0) throw Error('Invalid asset')
     const response=await assetsApi.download(id)
     target?.postMessage({type:'sg-v3-library-media',id,blob:response.data},window.location.origin)
    } catch {target?.postMessage({type:'sg-v3-library-media',id,error:true},window.location.origin)}
    return
   }
   if (event.data?.type === 'sg-v3-export') {
    const reply = (message: string) => target?.postMessage({type:'sg-v3-export-result',message},window.location.origin)
    try {
     const { clips, width, height, texts = [] } = event.data
     const supportedCanvas = (width === 1080 && height === 1920)
     || (width === 1920 && height === 1080)
     || (width === 1080 && height === 1080)
    if (!Array.isArray(clips)||!clips.length||clips.length>100||!supportedCanvas) throw Error('Invalid export project')
     if (!Array.isArray(texts)||texts.length>100||texts.some((t: Record<string, any>)=>typeof t.text!=='string'||t.text.length>4000||![t.start_time,t.end_time,t.x,t.y,t.font_size].every(Number.isFinite)||t.start_time<0||t.end_time<=t.start_time)) throw Error('Invalid text layers')
     const video: ExportVideo[] = []
     const upperVideo: ExportVideo[] = []
     const audio: ExportMedia[] = []
     const overlays = []
     for (const clip of clips) {
      if (!['video','audio','image'].includes(clip.kind)||!Number.isFinite(clip.start)||!Number.isFinite(clip.duration)||clip.start<0||clip.duration<=0) throw Error('Unsupported clip')
      let id = Number(clip.serverId)
      if (!Number.isSafeInteger(id)||id<=0) {
       if (!(clip.blob instanceof Blob)) throw Error('Missing media')
       const uploaded = await uploadApi.upload(new File([clip.blob],String(clip.name),{type:clip.blob.type}))
       id = uploaded.data.id
      }
      const trim = clip.trim ?? 0
      if (!Number.isFinite(trim) || trim < 0) throw Error('Invalid clip trim')
      const props = clip.properties ?? {}
      const muted = Boolean(clip.muted || props.clipMuted === 1)
      const fade = (value: unknown) =>
       typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(60, value)) : 0
      const effect = (value: unknown) =>
       typeof value === 'number' && Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0
      const requestedVolume = Number(clip.volume ?? 1)
      if (!Number.isFinite(requestedVolume)) throw Error('Invalid clip volume')
      const item = {asset_id:id,start_time:clip.start,end_time:clip.start+clip.duration,trim_in:trim,volume:muted?0:Math.max(0,Math.min(1,requestedVolume))}
      const percent = (value: unknown, fallback: number, min = 0) =>
       typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(100, value)) : fallback
      if (clip.kind === 'video') {
       if (clip.track !== 0 && clip.track !== 1) throw Error('Invalid video track')
       const track = clip.track === 0 ? video : upperVideo
       const transitions: Record<string,string> = {'Fade':'fade_black','Dissolve':'dissolve','Cross-dissolve':'dissolve','Wipe':'wipe','Slide':'slide','Push':'push','Zoom':'zoom_punch'}
       const seconds = fade(props.transitionDuration)
       track.push({...item,transition:seconds>0?(transitions[String(props.transition)]||'cut'):'cut',transition_duration:seconds,muted,speed:1,contrast:effect(props.contrast),saturation:effect(props.saturation),fit_mode:props.fitMode==='fill'?'fill':'fit',crop_x:percent(props.cropX,50),crop_y:percent(props.cropY,50),...(clip.track===1?{insert_x:percent(props.imageX,0),insert_y:percent(props.imageY,0),insert_width:percent(props.imageWidth,100,1),insert_height:percent(props.imageHeight,100,1)}:{})})
      } else if (clip.kind === 'image') {
       overlays.push({ ...item,animation:['Fade','Slide','Zoom'].includes(String(props.transition))?String(props.transition):'None',animation_duration:fade(props.transitionDuration),x:percent(props.imageX,0),y:percent(props.imageY,0),width:percent(props.imageWidth,100,1),height:percent(props.imageHeight,100,1),opacity:Math.max(0,Math.min(1,Number(clip.opacity ?? 1))),muted:true })
      } else {
       const fadeIn = Math.min(clip.duration,fade(props.fadeIn))
       const fadeOut = Math.min(clip.duration,fade(props.fadeOut))
       const scale = Math.min(1,clip.duration/(fadeIn+fadeOut || 1))
       audio.push({...item,fade_in:fadeIn*scale,fade_out:fadeOut*scale})
      }
     }
     if (!video.length) video.push(...upperVideo.splice(0))
     if (!video.length) throw Error('Add video first')
     for (const track of [video, upperVideo]) {
      track.sort((a, b) => a.start_time - b.start_time)
      if (track.some((clip, index) => index > 0 && clip.start_time < track[index - 1].end_time - 1e-6)) {
       throw Error('Overlapping clips on the same video track are unsupported')
      }
     }
     const baseEnd = video[video.length - 1].end_time
     const additionalVideo = []
     for (const clip of upperVideo) {
      if (clip.start_time < baseEnd) {
       const visible = {...clip,end_time:Math.min(clip.end_time,baseEnd)}
       additionalVideo.push({...visible,insert_x:visible.insert_x??0,insert_y:visible.insert_y??0,insert_width:visible.insert_width??100,insert_height:visible.insert_height??100})
       if (!clip.muted && (await assetsApi.hasAudioStream(clip.asset_id)).data.has_audio) {
        audio.push(visible)
       }
      }
      if (clip.end_time > baseEnd) {
       const start = Math.max(clip.start_time,baseEnd)
       video.push({...clip,start_time:start,trim_in:clip.trim_in+start-clip.start_time})
      }
     }
     // Reconstructor stores entrance effects; the join planner reads the outgoing clip.
     for (let i=0;i<video.length;i++) {
      const incoming=video[i+1]
      video[i].transition=incoming?.transition||'cut'
      video[i].transition_duration=incoming?.transition_duration||0
     }
     const result = await videoExportApi.exportProject({
      canvas_width:width,canvas_height:height,video_clips:video,additional_video_clips:additionalVideo,
      audio_tracks:audio,text_overlays:texts,media_overlays:overlays,
      timeline_duration:Math.max(...[...video,...audio,...overlays,...texts].map(clip => Number(clip.end_time))),
     })
     const url=URL.createObjectURL(result.data)
     const link=document.createElement('a');link.href=url;link.download='social-genius-v3.mp4';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
     reply('MP4 rendered — check downloads')
    } catch(e) {reply(e instanceof Error?e.message:'Export failed')}
    return
   }
   if (event.data?.type === 'sg-v3-list-drafts') {
    try {
     const { data } = await videoStudioDraftsApi.list()
     const drafts = (Array.isArray(data) ? data : [])
      .filter(draft => typeof draft.name === 'string' && draft.name.startsWith('V3 · '))
      .map(draft => ({ id: draft.id, name: draft.name.slice(5) }))
     target?.postMessage({type:'sg-v3-draft-list',drafts},window.location.origin)
    } catch {
     target?.postMessage({type:'sg-v3-draft-list',error:true},window.location.origin)
    }
    return
   }
   if (event.data?.type === 'sg-v3-save-server') {
    if (draftRequestPending) return
    draftRequestPending = true
    try {
     const draft = event.data.draft
     if (draft?.version !== 1 || !Array.isArray(draft.clips)) throw Error('Invalid draft')
     if (draft.clips.some((clip: { asset?: string }) => clip.asset && !/^server-[1-9]\d*$/.test(clip.asset))) throw Error('Upload locally attached media before cloud save')
     const body = { name: 'V3 · '+String(draft.title).slice(0,100), project_json: { editor_version: 3, draft } }
     const result = v3DraftId === null ? await videoStudioDraftsApi.create(body) : await videoStudioDraftsApi.update(v3DraftId,body)
     v3DraftId = result.data.id
     target?.postMessage({type:'sg-v3-server-result',message:'Server draft '+v3DraftId+' saved'},window.location.origin)
    } catch (error) {
     target?.postMessage({type:'sg-v3-server-result',message:error instanceof Error ? error.message : 'Server save failed'},window.location.origin)
    } finally { draftRequestPending = false }
    return
   }
   if (event.data?.type === 'sg-v3-open-server') {
    if (draftRequestPending) return
    draftRequestPending = true
    try {
     const id = Number(event.data.id)
     if (!Number.isSafeInteger(id)||id<=0) throw Error('Invalid draft ID')
     const result = await videoStudioDraftsApi.get(id)
     if (result.data.project_json?.editor_version !== 3) throw Error('Not a V3 draft')
     const draft = result.data.project_json.draft
     if (draft?.version !== 1 || !Array.isArray(draft.clips)) throw Error('Invalid draft')
     const assigned = new Map<number, string>()
     for (const clip of draft.clips) {
      const match = /^server-([1-9]\d*)$/.exec(clip.asset)
      if (match) assigned.set(Number(match[1]), String(clip.label))
     }
     const media = await Promise.all([...assigned].map(async ([assetId, name]) => {
      const { data: blob } = await assetsApi.download(assetId)
      return { id:assetId, name, kind:String(blob.type).split('/')[0], blob }
     }))
     v3DraftId = id
     target?.postMessage({type:'sg-v3-server-result',draft,media,message:'V3 server draft loaded'},window.location.origin)
    } catch { target?.postMessage({type:'sg-v3-server-result',message:'V3 draft or its assigned media unavailable'},window.location.origin) }
    finally { draftRequestPending = false }
    return
   }
   if(event.data?.type === 'sg-v3-import-analysis') {
    const params = new URLSearchParams(window.location.search)
    const referenceId = Number(params.get('reference'))
    const handoffId = Number(params.get('handoff'))
    try {
     if (!Number.isSafeInteger(referenceId) || referenceId <= 0 || !Number.isSafeInteger(handoffId) || handoffId <= 0) throw Error('Invalid handoff reference')
     const {data:savedHandoff} = await referenceVideosApi.handoff(referenceId,handoffId)
     const cached = JSON.parse(sessionStorage.getItem('sg-reconstructor-editor-blueprint') || 'null')
     const matches = cached?.version === 1 && cached.referenceId === referenceId && cached.handoffId === handoffId && Array.isArray(cached.scenes)
     const sourceScenes = matches ? cached.scenes : savedHandoff.scenes
     if (!Array.isArray(sourceScenes) || !sourceScenes.length) throw Error('Handoff contains no scenes')
     const blueprint = matches ? cached : {version:1,referenceId,handoffId,direction:{},replacement:{},assets:[],scenes:sourceScenes}
     let cursor = 0
     const scenes = sourceScenes.map((item: {number:number;plannedDuration?:number;role:string;story:string;start:number;end:number}) => {
      const sourceStart = Number(item.start), sourceEnd = Number(item.end)
      const duration = matches ? Number(item.plannedDuration ?? sourceEnd-sourceStart) : sourceEnd-sourceStart
      if (![sourceStart,sourceEnd,duration].every(Number.isFinite) || sourceStart < 0 || sourceEnd <= sourceStart || duration <= 0) throw Error('Invalid reconstruction scene timing')
      const start = cursor; cursor += duration
      return {...item,sourceStart,sourceEnd,start,end:cursor}
     })
     const media: Array<{id:number;name:string;kind:string;blob:Blob}> = []
     const failures: string[] = []
     for (const item of (Array.isArray(blueprint.assets)?blueprint.assets:[]).slice(0,60)) {
      const id = Number(item.assetId)
      if (!Number.isSafeInteger(id) || id <= 0) continue
      try {
       const {data:blob} = await assetsApi.download(id)
       media.push({id,name:String(item.title||'Asset'),kind:item.type==='images'?'image':item.type==='videos'?'video':'audio',blob})
      } catch { failures.push('Asset '+id+' could not be downloaded') }
     }
     let sourceAssetId: number | null = null
     try {
      const {data:reference} = await referenceVideosApi.get(referenceId)
      const id = Number(reference.asset_id)
      if (!Number.isSafeInteger(id) || id <= 0) throw Error('Reference has no media')
      const {data:blob} = await assetsApi.download(id)
      if (!(blob instanceof Blob)) throw Error('Reference media is not a file')
      sourceAssetId = id
      if (!media.some(item=>item.id===id)) media.push({id,name:'Original reference footage',kind:'video',blob})
     } catch { failures.push('Original reference footage is unavailable') }
     if (!disposed) target?.postMessage({type:'sg-v3-analysis-result',scenes,blueprint:{...blueprint,scenes,sourceAssetId},media,importWarnings:failures},window.location.origin)
    } catch(error) {
     if (!disposed) target?.postMessage({type:'sg-v3-analysis-result',error:true,message:error instanceof Error?error.message:'Unable to load reconstruction handoff'},window.location.origin)
    }
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
 return <iframe ref={frame} title="Video Studio V3" allowFullScreen srcDoc={editorHtml} style={{border:0,width:'100%',height:'100dvh',display:'block'}} />
}
