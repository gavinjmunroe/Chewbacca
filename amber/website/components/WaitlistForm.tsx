"use client";

import { FormEvent, useState } from "react";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const locked = status === "submitting" || status === "success";

  function clearError() {
    if (error) setError("");
    if (status === "error") setStatus("idle");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError("Please enter your full name.");
      setStatus("error");
      return;
    }
    if (!PHONE_PATTERN.test(trimmedPhone)) {
      setError("Enter a valid phone number.");
      setStatus("error");
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setError("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          phone: trimmedPhone,
          email: trimmedEmail,
          website,
        }),
      });

      if (!response.ok)
        throw new Error(`Submission failed (${response.status})`);

      setStatus("success");
    } catch (err) {
      console.error("[waitlist] submission failed", err);
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  if (status === "success") {
    return (
      <div className="form-success" role="status" aria-live="polite">
        <p className="form-success-title">You&rsquo;re on the list.</p>
        <p className="form-success-copy">We&rsquo;ll be in touch.</p>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="wl-name">Full name</label>
        <input
          id="wl-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          disabled={locked}
          aria-required="true"
          onChange={(e) => {
            setName(e.target.value);
            clearError();
          }}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="wl-phone">Phone number</label>
        <input
          id="wl-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          disabled={locked}
          aria-required="true"
          onChange={(e) => {
            setPhone(e.target.value);
            clearError();
          }}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="wl-email">Email</label>
        <input
          id="wl-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          disabled={locked}
          aria-required="true"
          onChange={(e) => {
            setEmail(e.target.value);
            clearError();
          }}
          required
        />
      </div>

      {/* Honeypot: humans never see or fill this */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="wl-website">Website</label>
        <input
          id="wl-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <button className="form-submit" type="submit" disabled={locked}>
        {status === "submitting" ? "Sending…" : "Join the waitlist"}
      </button>

      <p className="form-error" role="alert" data-visible={Boolean(error)}>
        {error}
      </p>
    </form>
  );
}
