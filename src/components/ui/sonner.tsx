'use client'

import React from 'react'
import { type CSSProperties } from 'react'
import { useEditorColorMode } from '@/hooks/editor/use-editor-preferences'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from 'lucide-react'

const toasterIcons = {
  success: <CircleCheckIcon className="size-4" />,
  info: <InfoIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <OctagonXIcon className="size-4" />,
  loading: <Loader2Icon className="size-4 animate-spin" />,
}

const toasterStyle = { '--border-radius': 'var(--radius)' } as CSSProperties

const toasterOptions = {
  classNames: {
    toast: 'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg data-[type=error]:!bg-red-500 data-[type=error]:!text-white data-[type=warning]:!bg-yellow-500 data-[type=warning]:!text-white data-[type=success]:!bg-green-500 data-[type=success]:!text-white',
    description: 'group-[.toast]:text-muted-foreground',
    actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
    cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
  },
}

const Toaster = React.memo(function Toaster({ ...props }: ToasterProps) {
  const colorMode = useEditorColorMode()

  return (
    <Sonner
      theme={colorMode}
      position="top-center"
      richColors
      className="toaster group"
      icons={toasterIcons}
      style={toasterStyle}
      toastOptions={toasterOptions}
      {...props}
    />
  )
})

export { Toaster }

