'use client'

import { forwardRef, useCallback } from 'react'
import TXTINPBUTBaseButton, {
  type TXTINPBUTBaseButtonHandle,
  type TXTINPBUTBaseButtonProps,
} from '../base/TXTINPBUTBaseButton/TXTINPBUTBaseButton'

export type TXTINPBUTIconWideButtonSearchProps = Omit<TXTINPBUTBaseButtonProps, 'shape' | 'prefixType' | 'label' | 'currencySymbol' | 'numeric'> & {
  searchQuery?: string
  /** Convenience hook fired on every keystroke (mirrors Android's local broadcast). */
  onQueryChange?: (query: string) => void
  /** Fully rounded until a result list is open, then flat along the bottom. */
  shape?: TXTINPBUTBaseButtonProps['shape']
}

const TXTINPBUTIconWideButtonSearch = forwardRef<TXTINPBUTBaseButtonHandle, TXTINPBUTIconWideButtonSearchProps>(
  ({ searchQuery, value, onQueryChange, onChange, placeholder = 'Search', shape = 'rounded', ...props }, ref) => {
    const handleChange = useCallback((next: string) => {
      onChange?.(next)
      onQueryChange?.(next)
    }, [onChange, onQueryChange])

    return (
      <TXTINPBUTBaseButton
        ref={ref}
        {...props}
        shape={shape}
        prefixType="icon"
        placeholder={placeholder}
        value={searchQuery ?? value}
        onChange={handleChange}
      />
    )
  },
)

TXTINPBUTIconWideButtonSearch.displayName = 'TXTINPBUTIconWideButtonSearch'

export default TXTINPBUTIconWideButtonSearch
