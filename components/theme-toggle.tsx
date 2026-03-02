'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Moon, Sun, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

const themes = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-transparent">
        <span className="sr-only">Theme</span>
      </div>
    )
  }

  const current = theme ?? 'system'

  return (
    <div className="flex rounded-md border border-input bg-transparent p-0.5">
      {themes.map(({ value, label, Icon }) => (
        <Button
          key={value}
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 w-8 px-0',
            current === value && 'bg-accent text-accent-foreground'
          )}
          onClick={() => setTheme(value)}
          title={`${label} (${value})`}
          aria-label={`Use ${label} theme`}
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  )
}
