import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@fontsource/forum/400.css";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "./styles.css";
import { AuthProvider, RequireUser } from "./auth";
import { FeedbackProvider } from "./components/ui";
import { Shell } from "./components/Shell";
import { LoginPage } from "./pages/Login";
import { SetupPage } from "./pages/Setup";
import { ErrorPage } from "./pages/ErrorPage";
import { ServicesPage } from "./pages/Services";
import { AccountPage } from "./pages/Account";
import { UsersPage } from "./pages/admin/Users";
import { GroupsPage } from "./pages/admin/Groups";
import { ProjectsPage } from "./pages/admin/Projects";
import { AuditPage } from "./pages/admin/Audit";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FeedbackProvider>
          <div className="wallpaper" aria-hidden="true" />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/error" element={<ErrorPage />} />
            <Route
              element={
                <RequireUser>
                  <Shell />
                </RequireUser>
              }
            >
              <Route index element={<ServicesPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="admin" element={<RequireUser admin><Navigate to="/admin/users" replace /></RequireUser>} />
              <Route path="admin/users" element={<RequireUser admin><UsersPage /></RequireUser>} />
              <Route path="admin/groups" element={<RequireUser admin><GroupsPage /></RequireUser>} />
              <Route path="admin/projects" element={<RequireUser admin><ProjectsPage /></RequireUser>} />
              <Route path="admin/audit" element={<RequireUser admin><AuditPage /></RequireUser>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </FeedbackProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
