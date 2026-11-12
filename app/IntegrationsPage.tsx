import React from 'react';
import {Label} from '@gravity-ui/uikit';
import {FileText, MessageSquare} from 'lucide-react';

// Planned providers are display metadata only. Credentials and live connection
// states belong to the server when the corresponding adapter is implemented.
const plannedIntegrations = [
  {id: 'mattermost', name: 'Mattermost', icon: MessageSquare,
    description: 'Задавайте вопросы Мнемонике прямо из рабочего чата.'},
  {id: 'confluence', name: 'Confluence', icon: FileText,
    description: 'Используйте базу знаний команды в работе с исследованиями.'},
];

export default function IntegrationsPage() {
  return <>
    <div className="page-heading"><div>
      <div className="overline">Настройки</div>
      <h1>Интеграции</h1>
      <p>Готовим подключения к сервисам команды.</p>
    </div></div>
    <ul className="settings-list integrations-list" role="list" aria-label="Планируемые интеграции">
      {plannedIntegrations.map(({id, name, icon: Icon, description}) =>
        <li className="setting-row integration-row" role="listitem" key={id}>
          <div className="setting-icon" aria-hidden="true"><Icon size={22}/></div>
          <div className="setting-main">
            <div className="integration-title"><h2>{name}</h2><Label theme="normal">Разрабатывается</Label></div>
            <p>{description}</p>
          </div>
        </li>,
      )}
    </ul>
  </>;
}
