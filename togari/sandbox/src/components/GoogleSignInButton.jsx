import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

// The OAuth client ID is a public identifier (it ships in the bundle either
// way), so a checked-in default is safe. Without it, a host whose build env
// lacks VITE_GOOGLE_CLIENT_ID silently drops the whole sign-in button.
const CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "813373326630-deu4s78t52trlvnn9ojdaeppsfk0kafj.apps.googleusercontent.com";

// GIS is a global singleton. Calling initialize() more than once logs
// "google.accounts.id.initialize() is called multiple times" and makes GIS
// reconfigure and redraw the button, a visible flicker on load. So we
// initialize exactly once per page load and route the callback through a ref,
// which lets each mount hand off a fresh handler without re-initializing.
let gisInitialized = false;
const credentialHandler = { current: null };

function ensureGisInitialized() {
  if (gisInitialized) return true;
  if (!window.google?.accounts?.id) return false;
  window.google.accounts.id.disableAutoSelect();
  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (response) => credentialHandler.current?.(response),
    auto_select: false,
    button_auto_select: false,
    hd: "bluemodernadvisory.com",
    ux_mode: "popup",
    use_fedcm_for_prompt: false,
    use_fedcm_for_button: false,
  });
  gisInitialized = true;
  return true;
}

export default function GoogleSignInButton() {
  const buttonRef = useRef(null);
  const { googleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = location.state?.from || "/wiki";
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  // Until GIS finishes loading its button iframe the slot is empty and the
  // button "pops in" a beat late. A placeholder fills the slot from first paint
  // and crossfades out once the real button has rendered; this flips it off.
  const [buttonReady, setButtonReady] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return;

    credentialHandler.current = async ({ credential }) => {
      setError("");
      try {
        await googleLogin(credential);
        navigate(destination, { replace: true });
      } catch (err) {
        setError(
          err.message ||
            "Sign-in failed. Choose your BMA Google account and try again.",
        );
      }
    };

    let revealed = false;
    let observer = null;
    const timers = [];
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      setButtonReady(true);
    };

    // Draw the button into this node once. Guarding on an already-present
    // iframe stops a second call (a late onGoogleLibraryLoad after the ready
    // path already ran, or a remount) from tearing the button down and
    // redrawing it.
    function renderButton() {
      const host = buttonRef.current;
      if (!host || !ensureGisInitialized()) return;
      if (host.querySelector("iframe")) {
        reveal();
        return;
      }
      window.google.accounts.id.renderButton(host, {
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: "signin_with",
        logo_alignment: "left",
        // GIS renders the iframe at the requested pixel width no matter how
        // wide the slot is, so the request must never exceed the measured slot
        // (or GIS's own 400px cap). A floor above the slot width was how the
        // button used to overflow the card on narrow viewports.
        width: Math.max(
          200,
          Math.min(400, Math.round(host.offsetWidth) || 320),
        ),
      });

      // Crossfade the placeholder out once the GIS iframe has loaded its
      // content, so the real button is painted before the placeholder goes.
      const watch = (iframe) =>
        iframe.addEventListener(
          "load",
          // 600ms: after load GIS often swaps its generic button for the
          // personalized account chip; holding the opaque placeholder past
          // that swap means the user sees one transition, not two, and the
          // fade never ghosts both texts over each other.
          () => timers.push(window.setTimeout(reveal, 600)),
          { once: true },
        );
      const iframe = host.querySelector("iframe");
      if (iframe) {
        watch(iframe);
      } else {
        observer = new MutationObserver(() => {
          const f = host.querySelector("iframe");
          if (f) {
            observer.disconnect();
            observer = null;
            watch(f);
          }
        });
        observer.observe(host, { childList: true, subtree: true });
      }
      // Fallback: if the iframe exists but never fires load, reveal anyway so
      // the placeholder can't get stuck over a button that is actually there.
      timers.push(
        window.setTimeout(() => {
          if (buttonRef.current?.querySelector("iframe")) reveal();
        }, 1800),
      );
    }

    if (window.google?.accounts?.id) {
      renderButton();
    } else {
      window.onGoogleLibraryLoad = renderButton;
    }

    // GIS reports a rejected origin only by 403-ing the button iframe and logging
    // to the console, so nothing here can catch it. Without this probe the host
    // renders an empty 312x44 box and the page looks like it simply forgot the
    // button. Detect the empty frame and say so instead.
    const probe = window.setTimeout(() => {
      const host = buttonRef.current;
      if (host && !host.querySelector("iframe")) {
        setUnavailable(true);
      }
    }, 3000);

    return () => {
      window.clearTimeout(probe);
      timers.forEach((t) => window.clearTimeout(t));
      if (observer) observer.disconnect();
      if (window.onGoogleLibraryLoad === renderButton) {
        window.onGoogleLibraryLoad = undefined;
      }
    };
  }, []);

  // Rendered when the client ID is missing entirely (it is a build-time env var,
  // so a deploy without VITE_GOOGLE_CLIENT_ID set drops the button). This used to
  // return a <Link to="/login">, which on the /login page itself is a link to
  // nowhere.
  if (!CLIENT_ID || unavailable) {
    return (
      <div className="google-signin-control">
        <p className="google-signin-fallback">
          Google sign-in is unavailable right now.
        </p>
        <a
          className="auth-footer-link"
          href="mailto:reem@bluemodernadvisory.com?subject=BMA Wiki access"
        >
          Contact BMA for access
        </a>
      </div>
    );
  }

  return (
    <div className="google-signin-control">
      <div className="google-signin-slot">
        <div ref={buttonRef} className="google-signin-button" />
        <div
          className={`google-signin-placeholder${
            buttonReady ? " google-signin-placeholder--ready" : ""
          }`}
          aria-hidden="true"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill="#4285F4"
              d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2822-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.964 10.71z"
            />
            <path
              fill="#EA4335"
              d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
            />
          </svg>
          <span>Sign in with Google</span>
        </div>
      </div>
      {error && (
        <p className="google-signin-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
