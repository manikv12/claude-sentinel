import React from 'react'

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-muted/30 dark:bg-muted/20 ${className}`} />
  )
}

