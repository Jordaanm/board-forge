import { Link, NavLink, Outlet } from 'react-router-dom';
import { DOC_GROUPS, DOC_NAV } from './nav';
import './docs.css';

export function DocsLayout() {
  return (
    <div className="docs">
      <header className="docs__header">
        <div className="docs__header-inner">
          <Link to="/" className="docs__brand">
            <span className="docs__brand-mark">B</span>
            <span>Board Together</span>
          </Link>
          <span className="docs__brand-tag">Docs</span>
        </div>
      </header>

      <div className="docs__body">
        <aside className="docs__sidebar">
          <nav>
            {DOC_GROUPS.map(group => (
              <div key={group} className="docs__nav-group">
                <h3 className="docs__nav-heading">{group}</h3>
                <ul className="docs__nav-list">
                  {DOC_NAV.filter(e => e.group === group).map(entry => (
                    <li key={entry.slug}>
                      <NavLink
                        to={`/docs/${entry.slug}`}
                        className={({ isActive }) =>
                          `docs__nav-link${isActive ? ' docs__nav-link--active' : ''}`
                        }
                      >
                        {entry.title}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main className="docs__main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
