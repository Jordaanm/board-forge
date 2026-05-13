// MUST be the first import: in prod builds it calls SES `lockdown()` which
// freezes JS intrinsics. Any prototype mutation that happens before this
// would be silently kept (or worse, fail the lockdown). Dev builds skip
// lockdown so HMR + devtools stay friendly. See bootstrap.ts.
import './scripting/bootstrap';
import './styles/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
