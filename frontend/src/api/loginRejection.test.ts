import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AxiosError, type AxiosAdapter} from 'axios'
import api, {authApi} from './client'

const removeItem=vi.fn()
const location={href:'/login'}
beforeEach(()=>{
  removeItem.mockClear()
  location.href='/login'
  vi.stubGlobal('localStorage',{getItem:()=>null,removeItem})
  vi.stubGlobal('window',{location})
})
afterEach(()=>vi.unstubAllGlobals())
function reject(status:number):AxiosAdapter {
  return async config=>{throw new AxiosError('Request rejected',String(status),config,undefined,{status,statusText:'Rejected',data:{detail:'Request rejected'},headers:{},config})}
}
describe('login rejection and session expiry',()=>{
  it('returns a rejected login to the form without reloading or clearing its session',async()=>{
    const old=api.defaults.adapter
    api.defaults.adapter=reject(401)
    try {
      await expect(authApi.login('test-account','test-input')).rejects.toMatchObject({response:{status:401}})
      expect(removeItem).not.toHaveBeenCalled()
      expect(location.href).toBe('/login')
    } finally {api.defaults.adapter=old}
  })
  it('still clears an expired session and redirects on a protected request',async()=>{
    location.href='/video-studio-v2'
    await expect(api.get('/auth/me',{adapter:reject(401)})).rejects.toMatchObject({response:{status:401}})
    expect(removeItem).toHaveBeenCalledWith('token')
    expect(location.href).toBe('/login')
  })
  it('does not sign out users on backend connectivity failures',async()=>{
    location.href='/video-studio-v2'
    await expect(api.get('/auth/me',{adapter:reject(503)})).rejects.toMatchObject({response:{status:503}})
    expect(removeItem).not.toHaveBeenCalled()
    expect(location.href).toBe('/video-studio-v2')
  })
})
