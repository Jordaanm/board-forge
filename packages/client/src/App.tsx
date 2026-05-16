import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import { PreferencesProvider } from './preferences/PreferencesContext';
import { usePreferences } from './preferences/usePreferences';

function ThemeBinder() {
  const { resolvedTheme } = usePreferences();
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [resolvedTheme]);
  return null;
}

function RoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const [search] = useSearchParams();
  const isHost = search.has('host');
  if (!roomId) return null;
  return <Room roomId={roomId} isHost={isHost} />;
}

function DocsPlaceholder() {
  return <div>Docs coming soon</div>;
}

export function App() {
  return (
    <PreferencesProvider>
      <ThemeBinder/>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/r/:roomId" element={<RoomRoute />} />
          <Route path="/docs" element={<DocsPlaceholder />} />
          <Route path="/docs/*" element={<DocsPlaceholder />} />
        </Routes>
      </BrowserRouter>
    </PreferencesProvider>
  );
}
