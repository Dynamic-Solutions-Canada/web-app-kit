import type { ReactNode } from 'react'
import { Box, Card, CardContent, Typography } from '@mui/joy'
import type { SxProps } from '@mui/joy/styles/types'

/**
 * Stable class names on each part of `EmptyState`, for restyling every empty state once
 * from an app's theme or global CSS. They are public API: renaming one is a major change.
 */
export const emptyStateClasses = {
  root: 'WebAppKit-EmptyState-root',
  icon: 'WebAppKit-EmptyState-icon',
  title: 'WebAppKit-EmptyState-title',
  description: 'WebAppKit-EmptyState-description',
} as const

export interface EmptyStateProps {
  /** A decorative icon naming the missing thing; hidden from assistive technology. */
  icon: ReactNode
  /** A short title saying what is missing. */
  title: ReactNode
  /** One sentence on why, or what to do about it. */
  description: ReactNode
  /** An optional action, such as a button that creates the first item. */
  action?: ReactNode
  /** Tighter spacing, for an empty state inside a card or a short list. */
  compact?: boolean
  /** Extra styles for the root card, applied after the defaults. */
  sx?: SxProps
}

/**
 * The one empty-state surface (UI-13): an icon, a title naming what is missing, one
 * sentence on why or what to do, and an optional action, centred in a dashed card.
 *
 * Colours come from the Joy theme, so it follows the light and dark schemes. An app that
 * wants its own look restyles it once through `emptyStateClasses` or per use through `sx`;
 * the component has no app-specific styling.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  sx,
}: EmptyStateProps) {
  // Joy merges an sx array in order, so the caller's styles win over the defaults.
  const callerSx = Array.isArray(sx) ? sx : [sx]

  return (
    <Card
      variant="outlined"
      className={emptyStateClasses.root}
      sx={[
        {
          borderStyle: 'dashed',
          borderColor: 'neutral.outlinedBorder',
          backgroundColor: 'background.level1',
        },
        ...callerSx,
      ]}
    >
      <CardContent
        sx={{
          alignItems: 'center',
          textAlign: 'center',
          py: compact ? { xs: 0.75, sm: 1 } : { xs: 1.5, sm: 2 },
          px: compact ? { xs: 0.5, sm: 0.75 } : { xs: 1, sm: 1.5 },
          gap: compact ? 0.75 : 1.25,
        }}
      >
        <Box
          aria-hidden
          className={emptyStateClasses.icon}
          sx={{
            width: compact ? 44 : 52,
            height: compact ? 44 : 52,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'primary.softColor',
            backgroundColor: 'primary.softBg',
            border: '1px solid',
            borderColor: 'primary.outlinedBorder',
          }}
        >
          {icon}
        </Box>
        <Typography
          className={emptyStateClasses.title}
          level={compact ? 'title-sm' : 'title-md'}
        >
          {title}
        </Typography>
        <Typography
          className={emptyStateClasses.description}
          level="body-sm"
          textColor="text.tertiary"
          sx={{ maxWidth: compact ? 380 : 440 }}
        >
          {description}
        </Typography>
        {action}
      </CardContent>
    </Card>
  )
}
