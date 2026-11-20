import { createContext, useContext } from 'react'
import type { BrandTokens } from '../postDocument'

/** The open carousel's Brand Kit as render tokens. Everything that draws a slide on screen (thumbnails, the editing canvas) and the export panel reads it from here. */
export const BrandTokensContext = createContext<BrandTokens | undefined>(undefined)
export const useBrandTokens = (): BrandTokens | undefined => useContext(BrandTokensContext)
