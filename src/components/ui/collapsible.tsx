"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

// Grid-based height animation using Base UI's lifecycle data attributes:
//
//  data-starting-style  — set for one animation frame when the panel mounts
//                         open; we force grid-rows to 0fr (!important wins over
//                         the default 1fr) so the transition has a defined
//                         starting point.
//  data-ending-style    — set while the exit transition runs (Base UI waits for
//                         getAnimations() to settle before unmounting), so we
//                         drive the grid row back to 0fr.
//
// No keepMounted: element is only in the DOM when open, which is the
// prerequisite for @starting-style / data-starting-style to trigger correctly.
function CollapsibleContent({ className, children, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className="grid grid-rows-[1fr] transition-[grid-template-rows] duration-300 ease-in-out data-[starting-style]:!grid-rows-[0fr] data-[ending-style]:!grid-rows-[0fr]"
      {...props}
    >
      <div className={`overflow-hidden ${className ?? ''}`}>
        {children}
      </div>
    </CollapsiblePrimitive.Panel>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
