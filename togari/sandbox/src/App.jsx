import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import GetStartedPage from "./pages/GetStartedPage.jsx";
import BMALoginPage from "./pages/BMALoginPage.jsx";
import BMATeamPage from "./pages/BMATeamPage.jsx";
import WikiPage from "./pages/WikiPage.jsx";
import DashboardLayout from "./pages/DashboardLayout.jsx";
import MassDataPage from "./pages/MassDataPage.jsx";
import PersonDrillPage from "./pages/PersonDrillPage.jsx";
import ChannelsPage from "./pages/ChannelsPage.jsx";
import ChannelDrillPage from "./pages/ChannelDrillPage.jsx";
import PipelinePage from "./pages/PipelinePage.jsx";
import ClientDrillPage from "./pages/ClientDrillPage.jsx";
import ManagementPage from "./pages/ManagementPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* Route paths match the old bluemodernadvisory.com paths 1:1 so
            redirected deep links land in the right place. */}
        <Route path="/" element={<Navigate to="/dash/data" replace />} />
        <Route path="/dash" element={<DashboardLayout />}>
          <Route index element={<Navigate to="/dash/data" replace />} />
          <Route path="data" element={<MassDataPage />} />
          <Route path="data/person/:personId" element={<PersonDrillPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="channels/:key" element={<ChannelDrillPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="pipeline/:clientId" element={<ClientDrillPage />} />
          <Route path="clients" element={<ManagementPage />} />
          <Route path="clients/:clientId" element={<ClientDrillPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        {/* Wiki lives inside the dashboard shell (top-bar nav, no sidebar)
            while keeping its absolute /wiki URL so existing links hold. */}
        <Route element={<DashboardLayout />}>
          <Route path="/wiki" element={<WikiPage />} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/get-started" element={<GetStartedPage />} />
        <Route path="/bma-login" element={<BMALoginPage />} />
        <Route
          path="/team"
          element={
            <ProtectedRoute>
              <BMATeamPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/dash/data" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
