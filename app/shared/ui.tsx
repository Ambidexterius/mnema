import { materialActivity } from '../material-activity.ts';
import React from 'react';
import { Button, Label, Tooltip, type ButtonProps } from '@gravity-ui/uikit';
import { Info, Library, LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Study } from '../types.ts';

export function IconButton({
  icon: Icon,
  label,
  size = 'l',
  ...props
}: {
  icon: LucideIcon;
  label: string;
  ref?: React.Ref<HTMLButtonElement>;
} & Omit<Extract<ButtonProps, { href?: never }>, 'children'>) {
  return (
    <Tooltip content={label}>
      <Button view="flat" size={size} aria-label={label} {...props}>
        <Icon size={size === 's' ? 14 : 18} aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="notice">
      <Info size={16} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
  icon: Icon = Library,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <Icon size={28} />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Status({ study }: { study: Study }) {
  const activity = study.activity || materialActivity(study);
  const active = ['queued', 'running'].includes(activity.state);
  return (
    <div className="material-status">
      <Label
        theme={
          active
            ? 'info'
            : activity.state === 'ready'
              ? 'success'
              : activity.state === 'error'
                ? 'danger'
                : 'normal'
        }
        size="s"
      >
        {active ? <LoaderCircle size={12} className="activity-spinner" aria-hidden="true" /> : null}
        {activity.label}
      </Label>
      {active && activity.detail ? <small>{activity.detail}</small> : null}
    </div>
  );
}

export function FormField({
  label,
  children,
  help,
}: {
  label: string;
  children: React.ReactElement<any>;
  help?: string;
}) {
  const id = React.useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
      {help ? <small>{help}</small> : null}
    </div>
  );
}
