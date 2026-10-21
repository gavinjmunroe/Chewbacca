import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
  errorMessage?: string
  showWordCount?: boolean
  maxWords?: number
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      error,
      errorMessage,
      showWordCount = false,
      maxWords,
      value,
      onChange,
      ...props
    },
    ref
  ) => {
    const [wordCount, setWordCount] = React.useState(0)

    React.useEffect(() => {
      if (value !== undefined) {
        const text = String(value).trim()
        const count = text === '' ? 0 : text.split(/\s+/).length
        setWordCount(count)
      }
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (showWordCount) {
        const text = e.target.value.trim()
        const count = text === '' ? 0 : text.split(/\s+/).length
        setWordCount(count)
      }
      onChange?.(e)
    }

    const isOverLimit = maxWords !== undefined && wordCount > maxWords

    return (
      <div className="w-full">
        <textarea
          className={cn(
            'flex min-h-[80px] w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-red-400 focus-visible:ring-red-500',
            isOverLimit && 'border-red-400 focus-visible:ring-red-500',
            className
          )}
          ref={ref}
          value={value}
          onChange={handleChange}
          aria-invalid={error ? 'true' : undefined}
          {...props}
        />
        {(showWordCount || error) && (
          <div className="mt-1 flex items-center justify-between">
            {error && errorMessage ? (
              <p className="text-xs text-red-500">{errorMessage}</p>
            ) : (
              <span />
            )}
            {showWordCount && (
              <p
                className={cn(
                  'ml-auto text-xs tabular-nums',
                  isOverLimit ? 'text-red-500' : 'text-stone-400'
                )}
              >
                {wordCount}
                {maxWords !== undefined && ` / ${maxWords}`} words
              </p>
            )}
          </div>
        )}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
