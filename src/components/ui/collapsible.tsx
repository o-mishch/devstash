"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { cn } from "@/lib/utils"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

// Height animation driven by Base UI's own measured panel height.
//
// Base UI sets --collapsible-panel-height to the panel's pixel height for the
// duration of each transition (and to `auto` while idle-open), and its
// transition-status state machine keeps the panel mounted until this height
// transition settles. Animating `height` toward that variable — rather than a
// CSS grid track — is the lifecycle Base UI is built around, so BOTH directions
// are honored. A grid-rows trick animates the open fine but is not reliably
// detected on exit, causing the panel to unmount instantly without a collapse.
//
//  data-starting-style — one frame when the panel mounts open; height 0 gives
//                        the entry transition a defined start.
//  data-ending-style   — applied while the exit transition runs; height 0
//                        drives the collapse before Base UI unmounts.
//
// No keepMounted: the element is only in the DOM when open, the prerequisite
// for data-starting-style / data-ending-style to fire correctly.
function CollapsibleContent({ className, children, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        'h-[var(--collapsible-panel-height)] overflow-hidden opacity-100',
        'transition-[height,opacity] duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]',
        'data-[starting-style]:h-0 data-[starting-style]:opacity-0',
        'data-[ending-style]:h-0 data-[ending-style]:opacity-0'
      )}
      {...props}
    >
      <div className={cn(className)}>
        {children}
      </div>
    </CollapsiblePrimitive.Panel>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
