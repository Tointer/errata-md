import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

interface DesktopFindBarProps {
  open: boolean
  query: string
  focusToken?: number
  matchCount: number
  activeMatchIndex: number
  onQueryChange: (value: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export function DesktopFindBar({
  open,
  query,
  focusToken = 0,
  matchCount,
  activeMatchIndex,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: DesktopFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [localQuery, setLocalQuery] = useState(query)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedQueryRef = useRef(query)

  useEffect(() => {
    if (query === lastSyncedQueryRef.current) return
    lastSyncedQueryRef.current = query
    setLocalQuery(query)
  }, [query])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open, focusToken])

  useEffect(() => {
    if (!open) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      if (localQuery === lastSyncedQueryRef.current) return
      lastSyncedQueryRef.current = localQuery
      onQueryChange(localQuery)
    }, 180)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [localQuery, onQueryChange, open])

  const flushQuery = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    if (localQuery === lastSyncedQueryRef.current) return
    lastSyncedQueryRef.current = localQuery
    onQueryChange(localQuery)
  }

  if (!open) return null

  const matchLabel = matchCount > 0
    ? `${activeMatchIndex + 1}/${matchCount}`
    : query.trim()
      ? '0 results'
      : 'Type to search'

  return (
    <div className="absolute top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border/50 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <input
        ref={inputRef}
        type="text"
        value={localQuery}
        onChange={(event) => setLocalQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            flushQuery()
            if (event.shiftKey) {
              onPrevious()
            } else {
              onNext()
            }
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        onBlur={flushQuery}
        placeholder="Find in story..."
        className="w-64 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        data-component-id="desktop-find-input"
      />
      <span className="min-w-16 text-right text-[0.6875rem] text-muted-foreground">
        {matchLabel}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrevious}
          disabled={matchCount === 0}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Previous match"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={matchCount === 0}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          title="Next match"
        >
          <ChevronDown className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Close find"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
