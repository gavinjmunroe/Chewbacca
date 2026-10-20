import { useEffect } from "react";
import { Link } from "react-router-dom";
import { MARKETING_URL } from "../config.js";

/* ─── AuthShell ──────────────────────────────────────────
   Full-page wrapper with the BMA dark gradient background */
export function AuthShell({ children }) {
  // index.html paints the shell gradient on <html> before React mounts so the
  // auth routes never flash the light body background. Once this shell is
  // gone, hand the canvas back to the stylesheet for the light routes.
  useEffect(() => {
    return () => {
      document.documentElement.style.background = "";
    };
  }, []);

  return (
    <div className="auth-shell">
      <div className="auth-shell-ambient auth-shell-ambient--1" />
      <div className="auth-shell-ambient auth-shell-ambient--2" />
      {children}
    </div>
  );
}

/* ─── AuthCard ───────────────────────────────────────────
   White glass card with logo + content */
export function AuthCard({ children }) {
  return (
    <div className="auth-card">
      {/* BMA logo mark */}
      <div className="auth-card-logo-wrap">
        <img
          src="/bma.png"
          alt="Blue Modern Advisory"
          className="auth-card-logo"
        />
      </div>
      {children}
    </div>
  );
}

/* ─── AuthHeading ────────────────────────────────────────*/
export function AuthHeading({ title, sub }) {
  return (
    <div className="auth-heading-block">
      <h1 className="auth-heading">{title}</h1>
      {sub && <p className="auth-sub">{sub}</p>}
    </div>
  );
}

/* ─── InputField ─────────────────────────────────────────
   Labeled input with optional error state */
export function InputField({
  label,
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  autoFocus,
  hasError,
}) {
  return (
    <div className="auth-field">
      <label htmlFor={id} className="auth-label">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        className={`auth-input${hasError ? " auth-input--error" : ""}`}
      />
    </div>
  );
}

/* ─── PrimaryButton ──────────────────────────────────────*/
export function PrimaryButton({
  children,
  loading,
  disabled,
  type = "submit",
}) {
  return (
    <button
      type={type}
      className="auth-btn-primary"
      disabled={loading || disabled}
    >
      {loading && <span className="auth-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ─── AuthError ──────────────────────────────────────────*/
export function AuthError({ message }) {
  if (!message) return null;
  return (
    <div className="auth-error" role="alert">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {message}
    </div>
  );
}

/* ─── AuthDivider ────────────────────────────────────────*/
export function AuthDivider() {
  return (
    <div className="auth-divider">
      <span>or</span>
    </div>
  );
}

/* ─── AuthFooter ─────────────────────────────────────────*/
export function AuthFooter({ text, linkText, linkTo }) {
  return (
    <p className="auth-footer-text">
      {text}{" "}
      <Link to={linkTo} className="auth-footer-link">
        {linkText}
      </Link>
    </p>
  );
}

/* ─── AuthBack ───────────────────────────────────────────
   Back-to-site link */
export function AuthBack() {
  return (
    <a href={MARKETING_URL} className="auth-back">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Back to site
    </a>
  );
}
