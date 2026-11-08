import type { ReactNode } from 'react';
import { useApp } from '../../app/store';
import { IconButton } from '../buttons/Button';
import { Icon } from './Icon';

export function ScreenHeader({ title, subtitle, end, onBack }: { title: string; subtitle?: string; end?: ReactNode; onBack?: () => void }) {
  const back = useApp((s) => s.back);
  const t = useApp((s) => s.t);
  return (
    <header className="header">
      <IconButton label={t('common.back')} onClick={onBack ?? back}>
        <Icon name="back" className="flip-rtl" />
      </IconButton>
      <div className="grow">
        <h1 className="header__title">{title}</h1>
        {subtitle && <div className="header__sub">{subtitle}</div>}
      </div>
      {end}
    </header>
  );
}
