"use client";
import { useState } from "react";
import Link from "next/link";
import {
  User,
  Phone,
  Heart,
  Shirt,
  Plane,
  BookOpen,
  CheckSquare,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface Props {
  campId: string;
  campName: string;
  scholarshipSpotsAvailable: boolean;
  travelReimbursementAvailable: boolean;
}

const T_SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 transition-colors";
const selectCls =
  "w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-violet-500/50 transition-colors";
const labelCls = "block text-xs font-semibold text-white/50 uppercase tracking-widest mb-2";
const sectionCls = "bg-white/[0.04] border border-white/10 rounded-2xl p-6 space-y-5";

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <Icon className="w-4 h-4 text-violet-400" />
      <h2 className="font-bold text-base">{title}</h2>
    </div>
  );
}

interface ConsentProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ConsentRow({ id, label, checked, onChange }: ConsentProps) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer group">
      <div
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
          checked
            ? "bg-violet-600 border-violet-500"
            : "bg-white/5 border-white/20 group-hover:border-violet-500/50"
        }`}
        onClick={() => onChange(!checked)}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="text-sm text-white/70 leading-relaxed">{label}</span>
    </label>
  );
}

export default function CampRegisterForm({
  campId,
  campName,
  scholarshipSpotsAvailable,
  travelReimbursementAvailable,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Emergency contact
  const [ecName, setEcName] = useState("");
  const [ecPhone, setEcPhone] = useState("");
  const [ecRelationship, setEcRelationship] = useState("");

  // Logistics
  const [dietaryRestrictions, setDietaryRestrictions] = useState("");
  const [tshirtSize, setTshirtSize] = useState<string>("");

  // Travel
  const [travelAssistance, setTravelAssistance] = useState(false);
  const [departureCity, setDepartureCity] = useState("");

  // Scholarship
  const [scholarshipRequest, setScholarshipRequest] = useState(false);
  const [scholarshipEssay, setScholarshipEssay] = useState("");

  // Consents
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentPhoto, setConsentPhoto] = useState(false);
  const [consentConduct, setConsentConduct] = useState(false);

  const wordCount = scholarshipEssay.trim().split(/\s+/).filter(Boolean).length;
  const allConsents = consentTerms && consentPhoto && consentConduct;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!ecName.trim()) { setError("Emergency contact name is required"); return; }
    if (!ecPhone.trim()) { setError("Emergency contact phone is required"); return; }
    if (!ecRelationship.trim()) { setError("Emergency contact relationship is required"); return; }
    if (!tshirtSize) { setError("Please select a t-shirt size"); return; }
    if (travelAssistance && !departureCity.trim()) {
      setError("Please enter your city of departure for travel assistance");
      return;
    }
    if (scholarshipRequest && wordCount < 50) {
      setError("Scholarship essay must be at least 50 words");
      return;
    }
    if (!allConsents) {
      setError("You must agree to all required terms before registering");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/camp-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campId,
          emergencyContact: {
            name: ecName.trim(),
            phone: ecPhone.trim(),
            relationship: ecRelationship.trim(),
          },
          dietaryRestrictions: dietaryRestrictions.trim() || null,
          tshirtSize,
          travelAssistance,
          departureCity: travelAssistance ? departureCity.trim() : null,
          scholarshipRequest,
          scholarshipEssay: scholarshipRequest ? scholarshipEssay.trim() : null,
          consents: {
            terms: consentTerms,
            photo: consentPhoto,
            conduct: consentConduct,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Registration failed");
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-6 bg-green-500/10 border border-green-500/25 rounded-2xl p-10 text-center">
        <CheckCircle2 className="w-14 h-14 text-green-400" />
        <div>
          <h2 className="text-2xl font-bold text-green-300 mb-2">Registration Confirmed!</h2>
          <p className="text-sm text-white/60">
            You&apos;ll receive a confirmation notification. See you there!
          </p>
        </div>
        <Link
          href="/dashboard/camps"
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-all"
        >
          View My Registrations
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Register for {campName}</h2>
        <p className="text-sm text-white/40">
          Complete all required fields to secure your spot.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div role="alert" className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Emergency Contact */}
      <div className={sectionCls}>
        <SectionHeader icon={User} title="Emergency Contact" />
        <p className="text-xs text-white/40 -mt-3">
          Required. This person will be contacted in the event of an emergency.
        </p>
        <div>
          <label className={labelCls}>Full Name *</label>
          <input
            value={ecName}
            onChange={(e) => setEcName(e.target.value)}
            placeholder="Jane Smith"
            required
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              <Phone className="inline w-3 h-3 mr-1 -mt-0.5" />
              Phone *
            </label>
            <input
              value={ecPhone}
              onChange={(e) => setEcPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Relationship *</label>
            <input
              value={ecRelationship}
              onChange={(e) => setEcRelationship(e.target.value)}
              placeholder="Parent, Spouse, Friend..."
              required
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Logistics */}
      <div className={sectionCls}>
        <SectionHeader icon={Shirt} title="Logistics" />
        <div>
          <label className={labelCls}>
            <Heart className="inline w-3 h-3 mr-1 -mt-0.5" />
            Dietary Restrictions
          </label>
          <input
            value={dietaryRestrictions}
            onChange={(e) => setDietaryRestrictions(e.target.value)}
            placeholder="Vegetarian, gluten-free, nut allergy, etc. Leave blank if none."
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>
            <Shirt className="inline w-3 h-3 mr-1 -mt-0.5" />
            T-Shirt Size *
          </label>
          <select
            value={tshirtSize}
            onChange={(e) => setTshirtSize(e.target.value)}
            required
            className={selectCls}
          >
            <option value="" disabled>Select size...</option>
            {T_SHIRT_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Travel Assistance */}
      {travelReimbursementAvailable && (
        <div className={sectionCls}>
          <SectionHeader icon={Plane} title="Travel Assistance" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Request travel reimbursement</div>
              <div className="text-xs text-white/40 mt-0.5">
                Reimbursement is capped and awarded based on distance and need.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTravelAssistance((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                travelAssistance ? "bg-violet-600" : "bg-white/10"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  travelAssistance ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {travelAssistance && (
            <div>
              <label className={labelCls}>City of Departure *</label>
              <input
                value={departureCity}
                onChange={(e) => setDepartureCity(e.target.value)}
                placeholder="e.g. Atlanta, GA"
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {/* Scholarship */}
      {scholarshipSpotsAvailable && (
        <div className={sectionCls}>
          <SectionHeader icon={BookOpen} title="Scholarship Request" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Apply for a scholarship spot</div>
              <div className="text-xs text-white/40 mt-0.5">
                Limited spots available. A short essay is required.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setScholarshipRequest((v) => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                scholarshipRequest ? "bg-violet-600" : "bg-white/10"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  scholarshipRequest ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
          {scholarshipRequest && (
            <div>
              <label className={labelCls}>
                Why do you need financial support? (200 words)
              </label>
              <textarea
                value={scholarshipEssay}
                onChange={(e) => setScholarshipEssay(e.target.value)}
                rows={6}
                placeholder="Describe your financial situation and why attending this camp matters to you..."
                className={`${inputCls} resize-none`}
              />
              <div
                className={`text-xs mt-1.5 ${
                  wordCount >= 50 ? "text-white/30" : "text-amber-400"
                }`}
              >
                {wordCount} / 200 words {wordCount < 50 && "(minimum 50 words required)"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Consents */}
      <div className={sectionCls}>
        <SectionHeader icon={CheckSquare} title="Agreements" />
        <p className="text-xs text-white/40 -mt-3">All fields are required to register.</p>
        <div className="space-y-4">
          <ConsentRow
            id="consent-terms"
            label="I agree to the EGATS Terms of Service and understand the camp policies, including the no-refund policy within 7 days of the event."
            checked={consentTerms}
            onChange={setConsentTerms}
          />
          <ConsentRow
            id="consent-photo"
            label="I grant EGATS permission to photograph and video record my participation in camp activities for promotional and evaluation purposes."
            checked={consentPhoto}
            onChange={setConsentPhoto}
          />
          <ConsentRow
            id="consent-conduct"
            label="I agree to uphold the EGATS Code of Conduct, including professional behavior, respect for other dancers and staff, and zero-tolerance policies."
            checked={consentConduct}
            onChange={setConsentConduct}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-8 py-4 rounded-xl transition-colors text-base"
      >
        {submitting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Registering...
          </>
        ) : (
          "Complete Registration"
        )}
      </button>
    </form>
  );
}
