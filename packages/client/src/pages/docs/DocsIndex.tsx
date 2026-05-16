import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { DOC_GROUPS, DOC_NAV } from './nav';

const GROUP_BLURBS: Record<string, string> = {
  'Playing':                   'Pick up a controller and join a table.',
  'Hosting & authoring':       'Run a room and shape what happens inside it.',
  'Working on the codebase':   'Dig into the engine itself.',
};

const ENTRY_BLURBS: Record<string, string> = {
  'getting-started': 'Install, run, create or join a room.',
  'controls':        'Camera, tools, context menu, hand panel, claiming a seat.',
  'hosting':         'Host action bar, editor panel, save/load, history.',
  'scripting':       'Author a custom game by extending Game.',
  'architecture':    'Repository layout, entity/component model, networking.',
  'contributing':    'Dev setup, scripts, test layout, where to add things.',
};

export function DocsIndex() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Docs · Board Together';
    return () => { document.title = previous; };
  }, []);

  return (
    <div className="docs-index">
      <section className="docs-index__hero">
        <h1 className="docs-index__title">Board Together</h1>
        <p className="docs-index__lede">
          A browser-based virtual tabletop — a real-time physics sandbox for
          playing and prototyping tabletop games.
        </p>
      </section>

      {DOC_GROUPS.map(group => (
        <section key={group} className="docs-index__group">
          <h2 className="docs-index__group-title">{group}</h2>
          <p className="docs-index__group-blurb">{GROUP_BLURBS[group]}</p>
          <ul className="docs-index__cards">
            {DOC_NAV.filter(e => e.group === group).map(entry => (
              <li key={entry.slug}>
                <Link to={`/docs/${entry.slug}`} className="docs-index__card">
                  <span className="docs-index__card-title">{entry.title}</span>
                  <span className="docs-index__card-blurb">
                    {ENTRY_BLURBS[entry.slug] ?? ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
