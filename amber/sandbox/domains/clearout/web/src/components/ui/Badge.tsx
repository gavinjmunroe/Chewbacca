import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full text-xs font-medium px-2 py-0.5 transition-colors",
  {
    variants: {
      variant: {
        default: "bg-co-blue/15 text-co-blue border border-co-blue/20",
        urgent: "bg-red-500/15 text-red-400 border border-red-500/20",
        high: "bg-orange-500/15 text-orange-400 border border-orange-500/20",
        medium: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
        low: "bg-co-border text-muted-foreground",
        success: "bg-green-500/15 text-green-400 border border-green-500/20",
        ghost: "bg-co-panel text-muted-foreground",
        channel: "bg-co-panel border border-co-border text-foreground/70",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
