import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import { DocsPage } from './pages/docs/DocsPage';
import { DocsLayout } from './pages/docs/DocsLayout';
import { DocsIndex } from './pages/docs/DocsIndex';
import { DiscordCallbackPage } from './pages/DiscordCallbackPage';
import { PreferencesProvider } from './preferences/PreferencesContext';
import { usePreferences } from './preferences/usePreferences';
import { DiscordAuthProvider } from './discord/DiscordAuthProvider';
import { DiscordRefreshBanner } from './components/DiscordRefreshBanner';

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

export function App() {
  return (
    <PreferencesProvider>
      <DiscordAuthProvider>
        <ThemeBinder/>
        <BrowserRouter>
          <DiscordRefreshBanner />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/r/:roomId" element={<RoomRoute />} />
            <Route path="/auth/discord/callback" element={<DiscordCallbackPage />} />
            <Route path="/docs" element={<DocsLayout />}>
              <Route index element={<DocsIndex />} />
              <Route path=":slug" element={<DocsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </DiscordAuthProvider>
    </PreferencesProvider>
  );
}
