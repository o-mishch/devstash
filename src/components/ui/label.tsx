"use client"

import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // Generic primitive: `htmlFor` and text content are entirely supplied by each consumer
    // (12 call sites across the app), so static analysis can't see the association here.
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
