// Independent V3 shell; no legacy Layout or AppShell.
import editorHtml from '../../../../ui-v3/index.html?raw'
export default function VideoStudioV3() {
 return <iframe title="Video Studio V3" srcDoc={editorHtml} style={{border:0,width:'100%',height:'100dvh',display:'block'}} />
}
