import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-stone-900 text-stone-50 hover:bg-stone-800',
        secondary:
          'border-transparent bg-stone-100 text-stone-900 hover:bg-stone-200',
        destructive:
          'border-transparent bg-red-100 text-red-700 hover:bg-red-200',
        outline: 'border-stone-200 text-stone-700',
        success:
          'border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
        warning:
          'border-transparent bg-amber-100 text-amber-700 hover:bg-amber-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
