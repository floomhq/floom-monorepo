import { Link } from 'react-router-dom';
import { AppIcon } from '../../AppIcon';
import type { HubApp } from '../../../lib/types';

interface Props {
  apps: HubApp[];
  onPickApp: (app: HubApp) => void;
}

export function PublicAppsResponse({ apps, onPickApp }: Props) {
  if (apps.length === 0) {
    return (
      <div className="assistant-turn">
        <p className="assistant-preamble">Loading public apps…</p>
      </div>
    );
  }
  return (
    <div className="assistant-turn">
      <p className="assistant-preamble">
        {apps.length} public apps available. Click any to run it.
      </p>
      <div className="trending-grid">
        {apps.map((app) => (
          <Link
            key={app.slug}
            to={`/p/${app.slug}`}
            className="app-tile"
            onClick={() => onPickApp(app)}
            style={{ textAlign: 'left', width: '100%', textDecoration: 'none', display: 'block' }}
          >
            <div className="app-tile-icon">
              <AppIcon slug={app.slug} size={24} />
            </div>
            <div className="app-tile-name">{app.name}</div>
            <div className="app-tile-desc">{app.description}</div>
            <div className="app-tile-runs">
              {app.actions.length} action{app.actions.length === 1 ? '' : 's'}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
