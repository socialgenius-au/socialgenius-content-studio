import { useEffect, useRef } from 'react'
import { assetsApi } from '../../api/client'
import editorHtml from '../../../../ui-v3/index.html?raw'
export default function VideoStudioV3() {
 const frame = useRef<HTMLIFrameElement>(null)
 useEffect(() => {
  let disposed = false
  const receive = async (event: MessageEvent) => {
   if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin || event.data?.type !== 'sg-v3-import-assets') return
   const target = frame.current?.contentWindow
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
