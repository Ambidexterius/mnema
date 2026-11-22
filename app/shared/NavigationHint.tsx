import type React from 'react';
import { Hotkey, Tooltip } from '@gravity-ui/uikit';
import { MOBILE_WEB_QUERY, useCompactLayout } from '../useCompactLayout.ts';

export function NavigationHint({
  label,
  enabled,
  shortcut,
  children,
}: {
  label: string;
  enabled: boolean;
  shortcut?: string;
  children: React.ReactElement;
}) {
  const mobileWeb = useCompactLayout(MOBILE_WEB_QUERY);
  return (
    <Tooltip
      content={
        shortcut ? (
          <span className="creation-shortcut-tooltip">
            <span>{label}</span>
            <Hotkey value={shortcut} />
          </span>
        ) : (
          label
        )
      }
      disabled={!enabled || mobileWeb}
      placement="right"
      openDelay={200}
      closeDelay={80}
    >
      {children}
    </Tooltip>
  );
}
