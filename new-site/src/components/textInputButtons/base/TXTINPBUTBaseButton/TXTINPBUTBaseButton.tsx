'use client'

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import type { ButtonColorVariant, ButtonShape } from '../../../buttons/base/BUTBaseButton/BUTBaseButton'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import '../../../buttons/base/BUTBaseButton/BUTBaseButton.css'
import './TXTINPBUTBaseButton.css'

export type TXTINPBUTPrefixType = 'none' | 'icon' | 'label' | 'currency' | 'icon-or-label'

export interface TXTINPBUTBaseButtonProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue' | 'className' | 'onSubmit'> {
  shape?: ButtonShape
  colorVariant?: ButtonColorVariant
  prefixType?: TXTINPBUTPrefixType
  icon?: React.ReactNode
  label?: string
  currencySymbol?: string
  value?: string
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  uppercase?: boolean
  stripSpaces?: boolean
  numeric?: boolean
  showClear?: boolean
  onChange?: (value: string) => void
  onInputChange?: React.ChangeEventHandler<HTMLInputElement>
  onClear?: () => void
  onSubmit?: (value: string) => void
  onFocus?: (event: React.FocusEvent<HTMLInputElement>) => void
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  ariaLabel?: string
  className?: string
  inputClassName?: string
  id?: string
  inputId?: string
  name?: string
  autoComplete?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  pattern?: string
  autoCapitalize?: string
  autoCorrect?: string
  spellCheck?: boolean
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>['enterKeyHint']
  autoFocus?: boolean
  maxLength?: number
  style?: React.CSSProperties
  forceFocusedAppearance?: boolean
  skeleton?: boolean
}

export interface TXTINPBUTBaseButtonHandle {
  focus: () => void
  blur: () => void
  clear: () => void
  getValue: () => string
}

const NUMERIC_PATTERN = /^-?\d*\.?\d*$/
const LEGACY_INNER_INPUT_CLASSES = new Set(['edit-input', 'search-input'])

const ClearIcon: React.FC = () => (
  <X size={14} weight="bold" aria-hidden />
)

const TXTINPBUTBaseButton = forwardRef<TXTINPBUTBaseButtonHandle, TXTINPBUTBaseButtonProps>(({
  shape = 'rounded',
  colorVariant = 'primary',
  prefixType = 'none',
  icon,
  label,
  currencySymbol = '£',
  value,
  defaultValue,
  placeholder,
  disabled = false,
  uppercase = false,
  stripSpaces = false,
  numeric = false,
  showClear = true,
  onChange,
  onInputChange,
  onClear,
  onSubmit,
  onFocus,
  onBlur,
  onKeyDown,
  ariaLabel,
  className = '',
  inputClassName = '',
  id,
  inputId,
  name,
  autoComplete,
  inputMode,
  pattern,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  enterKeyHint,
  autoFocus,
  maxLength,
  type = 'text',
  style,
  forceFocusedAppearance = false,
  skeleton = false,
  ...restInputProps
}, ref) => {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState<string>(defaultValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const currentValue = isControlled ? (value ?? '') : internalValue

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    clear: () => {
      if (!isControlled) setInternalValue('')
      onChange?.('')
      onClear?.()
    },
    getValue: () => currentValue,
  }), [isControlled, onChange, onClear, currentValue])

  const transformValue = useCallback((raw: string): string => {
    let next = raw
    if (stripSpaces) next = next.replace(/\s+/g, '')
    if (uppercase) next = next.toUpperCase()
    return next
  }, [stripSpaces, uppercase])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    if (numeric && raw !== '' && !NUMERIC_PATTERN.test(raw)) return
    const next = transformValue(raw)
    if (!isControlled) setInternalValue(next)
    onInputChange?.(event)
    onChange?.(next)
  }

  const handleClearClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return
    if (!isControlled) setInternalValue('')
    onChange?.('')
    onClear?.()
    inputRef.current?.blur()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.key === 'Enter') {
      event.preventDefault()
      inputRef.current?.blur()
      onSubmit?.(currentValue)
    }
  }

  useEffect(() => {
    if (!isControlled) return
    if (!uppercase && !stripSpaces) return
    const transformed = transformValue(currentValue)
    if (transformed !== currentValue) onChange?.(transformed)
  }, [currentValue, isControlled, uppercase, stripSpaces, transformValue, onChange])

  const hasValue = currentValue.length > 0
  const state = disabled ? 'disabled' : 'active'

  const wrapperClasses = [
    'rs-button',
    'rs-button--wide',
    `rs-button--${shape}`,
    `rs-button--${state}`,
    `rs-button--color-${colorVariant}`,
    'rs-input',
    `rs-input--prefix-${prefixType}`,
    hasValue && 'rs-input--has-value',
    forceFocusedAppearance && 'rs-input--force-focused',
    disabled && 'rs-input--disabled',
    skeleton && 'rs-input--skeleton',
    className,
  ].filter(Boolean).join(' ')

  const renderPrefix = () => {
    if (prefixType === 'none') return null
    if (prefixType === 'icon') {
      return icon ? <span className="rs-input__prefix rs-input__prefix--icon" aria-hidden="true">{icon}</span> : null
    }
    if (prefixType === 'label') {
      return label ? (
        <span className="rs-input__prefix rs-input__prefix--label">
          {skeleton ? <TextSkeletonLine>{label}</TextSkeletonLine> : label}
        </span>
      ) : null
    }
    if (prefixType === 'currency') {
      return <span className="rs-input__prefix rs-input__prefix--currency">{currencySymbol}</span>
    }
    if (prefixType === 'icon-or-label') {
      if (label) return <span className="rs-input__prefix rs-input__prefix--label">{label}</span>
      return icon ? <span className="rs-input__prefix rs-input__prefix--icon" aria-hidden="true">{icon}</span> : null
    }
    return null
  }

  const sanitizedInputClassName = inputClassName
    .split(/\s+/)
    .filter((token) => token && !LEGACY_INNER_INPUT_CLASSES.has(token))
    .join(' ')

  const inputClasses = ['rs-input__field', sanitizedInputClassName].filter(Boolean).join(' ')

  return (
    <label className={wrapperClasses} style={style}>
      {renderPrefix()}
      <span className="rs-input__field-slot">
        <input
          ref={inputRef}
          id={inputId ?? id}
          name={name}
          type={type}
          className={inputClasses}
          value={currentValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          autoComplete={autoComplete}
          inputMode={numeric ? 'decimal' : inputMode}
          pattern={pattern}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          spellCheck={spellCheck}
          enterKeyHint={enterKeyHint}
          autoFocus={autoFocus}
          maxLength={maxLength}
          {...restInputProps}
        />
        {skeleton ? (
          <span className="rs-input__field-skeleton" aria-hidden="true">
            <TextSkeletonLine>{currentValue || placeholder || 'Station'}</TextSkeletonLine>
          </span>
        ) : null}
      </span>
      {showClear && (
        <button
          type="button"
          className="rs-input__clear"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClearClick}
          aria-label="Clear input"
          tabIndex={-1}
          disabled={disabled || !hasValue}
        >
          <ClearIcon />
        </button>
      )}
      <div className="rs-button__inner-shadow" aria-hidden="true" />
    </label>
  )
})

TXTINPBUTBaseButton.displayName = 'TXTINPBUTBaseButton'

export default TXTINPBUTBaseButton
