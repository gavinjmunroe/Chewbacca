import { Link, useLocation } from "react-router-dom";
import GoogleSignInButton from "../components/GoogleSignInButton.jsx";
import {
  AuthShell,
  AuthCard,
  AuthHeading,
  AuthBack,
} from "../components/AuthComponents.jsx";
import { MARKETING_URL } from "../config.js";

export default function LoginPage() {
  const location = useLocation();
  const destination = location.state?.from || "/wiki";

  return (
    <AuthShell>
      <AuthBack />
      <AuthCard>
        <AuthHeading
          title="Sign in to the BMA Wiki"
          sub="Access limited to BMA employees."
        />

        <div className="auth-google-panel">
          <GoogleSignInButton />
        </div>

        <p className="auth-footer-text">
          Need access?{" "}
          <a
            href="mailto:reem@bluemodernadvisory.com?subject=BMA Wiki access"
            className="auth-footer-link"
          >
            Contact BMA
          </a>
        </p>
        {destination === "/wiki" ? (
          <a href={MARKETING_URL} className="auth-secondary-link">
            Return to the public site
          </a>
        ) : (
          <Link to={destination} className="auth-secondary-link">
            Return to the public site
          </Link>
        )}
      </AuthCard>
    </AuthShell>
  );
}
