import { useMemo } from 'react'
import { brandKitsApi, carouselsApi, libraryItemsApi } from '../../api/client'
import { createHttpBrandKitStore, type BrandKitStore } from '../../lib/carousel/assetsStore'
import { createHttpLibraryStore, type LibraryStore } from '../../lib/carousel/libraryStore'
import { createHttpCarouselServer, type CarouselServer } from '../../lib/carousel/serverStore'
import { browserStorage, type KeyValueStorage } from '../../lib/carousel/storage'
import NewPostCreatorScreen from './NewPostCreatorScreen'
import { PostFormatProvider } from './format/PostFormatContext'

export interface PostCreatorV2Props {
  server?: CarouselServer
  storage?: KeyValueStorage | null
  brandStore?: BrandKitStore
  libraryStore?: LibraryStore
}

export default function PostCreatorV2({ server: serverProp, storage: storageProp, brandStore: brandProp, libraryStore: libraryProp }: PostCreatorV2Props = {}) {
  const server = useMemo(() => serverProp ?? createHttpCarouselServer(carouselsApi), [serverProp])
  const storage = useMemo(() => storageProp === undefined ? browserStorage() : storageProp, [storageProp])
  const brandStore = useMemo(() => brandProp ?? createHttpBrandKitStore(brandKitsApi), [brandProp])
  const libraryStore = useMemo(() => libraryProp ?? createHttpLibraryStore(libraryItemsApi), [libraryProp])
  return <PostFormatProvider>
    <NewPostCreatorScreen server={server} storage={storage} brandStore={brandStore} libraryStore={libraryStore}/>
  </PostFormatProvider>
}
