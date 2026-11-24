import { useEffect, useRef } from 'react'
import { assetsApi, videoStudioDraftsApi } from '../../api/client'
import editorHtml from '../../../../ui-v3/index.html?raw'
export default function VideoStudioV3() {
 const frame = useRef<HTMLIFrameElement>(null)
 useEffect(() => {
  let disposed = false
  let v3DraftId: number | null = null
  const receive = async (event: MessageEvent) => {
   if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
   const target = frame.current?.contentWindow
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
