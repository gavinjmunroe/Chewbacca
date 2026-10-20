import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

type TabKey = "signal" | "data"
type SignalPlanKey = "starter" | "standard" | "professional" | "enterprise"
type NotifyMethod = "email" | "slack"

type FrequencyKey = "daily" | "weekly"

const SIGNAL_PLANS: {
    [key in SignalPlanKey]: {
        name: string
        maxCompanies: number
    }
} = {
    starter: { name: "Starter", maxCompanies: 50 },
    standard: { name: "Standard", maxCompanies: 100 },
    professional: { name: "Professional", maxCompanies: 200 },
    enterprise: { name: "Enterprise", maxCompanies: 500 },
}

const FREQUENCY_PRICES: Record<FrequencyKey, Partial<Record<SignalPlanKey, number>>> = {
    daily: { standard: 149, professional: 199, enterprise: 349 },
    weekly: { starter: 50, standard: 60, professional: 100, enterprise: 150 },
}

const COMPANY_SIZE_MAP: { [key: string]: string } = {
    "Self-employed": "A",
    "1-10 employees": "B",
    "11-50 employees": "C",
    "51-200 employees": "D",
    "201-500 employees": "E",
    "501-1,000 employees": "F",
    "1,001-5,000 employees": "G",
    "5,001-10,000 employees": "H",
    "10,001+ employees": "I",
}
const COMPANY_SIZES = Object.keys(COMPANY_SIZE_MAP)

const INDUSTRIES = [
    "Accounting",
    "Biotechnology",
    "Computer Software",
    "Construction",
    "Consumer Electronics",
    "Financial Services",
    "Health Care",
    "Hospital & Health Care",
    "Information Technology Services",
    "Insurance",
    "Internet",
    "Investment Management",
    "Law Practice",
    "Legal Services",
    "Logistics & Supply Chain",
    "Management Consulting",
    "Marketing & Advertising",
    "Medical Device",
    "Pharmaceuticals",
    "Real Estate",
    "Retail",
    "SaaS",
    "Staffing & Recruiting",
    "Telecommunications",
    "Venture Capital & Private Equity",
]

function estimateDataPullPrice(count: number) {
    let cost = 0
    let remaining = count

    const t1 = Math.min(remaining, 250)
    cost += t1 * 0.5
    remaining -= t1

    if (remaining > 0) {
        const t2 = Math.min(remaining, 750)
        cost += t2 * 0.3
        remaining -= t2
    }

    if (remaining > 0) {
        cost += remaining * 0.2
    }

    return Math.round(cost * 100) / 100
}

function formatCurrency(value: number) {
    return `$${value.toLocaleString()}`
}

function getBreakdown(count: number) {
    if (count <= 250) return `${count} × $0.50/ea`
    if (count <= 1000) return `250 × $0.50 + ${count - 250} × $0.30`
    return `250 × $0.50 + 750 × $0.30 + ${count - 1000} × $0.20`
}

type MultiSelectProps = {
    label?: string
    options: string[]
    selected: string[]
    onChange: (values: string[]) => void
    placeholder?: string
}

function MultiSelect(props: MultiSelectProps) {
    const { options, selected, onChange, placeholder = "Select..." } = props
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () =>
            document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const filtered = options.filter((option) =>
        option.toLowerCase().includes(query.toLowerCase())
    )

    function toggleOption(value: string) {
        if (selected.includes(value)) {
            onChange(selected.filter((v) => v !== value))
        } else {
            onChange([...selected, value])
        }
    }

    return (
        <div style={styles.multiWrap} ref={ref}>
            <button
                type="button"
                style={styles.multiTrigger}
                onClick={() => setOpen(!open)}
            >
                <span
                    style={
                        selected.length
                            ? styles.multiText
                            : styles.placeholderText
                    }
                >
                    {selected.length
                        ? `${selected.length} selected`
                        : placeholder}
                </span>
                <span style={styles.arrow}>{open ? "▲" : "▼"}</span>
            </button>

            {selected.length > 0 && (
                <div style={styles.tagsWrap}>
                    {selected.map((tag) => (
                        <span key={tag} style={styles.tag}>
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {open && (
                <div style={styles.dropdown}>
                    <input
                        style={styles.searchInput}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search..."
                    />
                    <div style={styles.dropdownList}>
                        {filtered.length ? (
                            filtered.map((option) => {
                                const checked = selected.includes(option)
                                return (
                                    <label
                                        key={option}
                                        style={styles.dropdownItem}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() =>
                                                toggleOption(option)
                                            }
                                        />
                                        <span>{option}</span>
                                    </label>
                                )
                            })
                        ) : (
                            <div style={styles.emptyDropdown}>No matches</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

type FieldProps = {
    label: string
    required?: boolean
    hint?: string
    children: React.ReactNode
}

function Field(props: FieldProps) {
    return (
        <div style={styles.field}>
            <label style={styles.label}>
                {props.label}
                {props.required ? (
                    <span style={styles.required}> *</span>
                ) : null}
            </label>
            {props.children}
            {props.hint ? <div style={styles.hint}>{props.hint}</div> : null}
        </div>
    )
}

export default function SubscriptionModal(props: {
    apiBase: string
    framerSecret: string
    showClose: boolean
    title: string
    subtitle: string
    isOpen: boolean
    showDataPullTab: boolean
    showEmailOption: boolean
    onClose?: () => void
}) {
    const [activeTab, setActiveTab] = React.useState<TabKey>("signal")
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    const [success, setSuccess] = React.useState("")
    const [closed, setClosed] = React.useState(false)

    const [selectedPlan, setSelectedPlan] =
        React.useState<SignalPlanKey>("starter")

    const [signalEmail, setSignalEmail] = React.useState("")
    const [signalName, setSignalName] = React.useState("")
    const [signalQuery, setSignalQuery] = React.useState("")
    const [signalJobTitles, setSignalJobTitles] = React.useState("")
    const [signalTargetCompanies, setSignalTargetCompanies] = React.useState("")
    const [signalIndustries, setSignalIndustries] = React.useState<string[]>([])
    const [signalCompanySizes, setSignalCompanySizes] = React.useState<
        string[]
    >([])
    const [signalFrequency, setSignalFrequency] =
        React.useState<FrequencyKey>("weekly")
    const effectiveFrequency: FrequencyKey =
        signalFrequency === "daily" && selectedPlan === "starter"
            ? "weekly"
            : signalFrequency
    const signalPrice =
        FREQUENCY_PRICES[effectiveFrequency][selectedPlan] ?? 0
    const [notifyMethod, setNotifyMethod] =
        React.useState<NotifyMethod>("slack")
    const [signalNotifyEmail, setSignalNotifyEmail] = React.useState("")

    const [dataEmail, setDataEmail] = React.useState("")
    const [dataQuery, setDataQuery] = React.useState("")
    const [dataTargetCompanies, setDataTargetCompanies] = React.useState("")
    const [dataIndustries, setDataIndustries] = React.useState<string[]>([])
    const [dataCompanySizes, setDataCompanySizes] = React.useState<string[]>([])
    const [selectedCount, setSelectedCount] = React.useState(500)

    const dataPrice = React.useMemo(
        () => estimateDataPullPrice(selectedCount),
        [selectedCount]
    )

    React.useEffect(() => {
        if (props.isOpen) {
            setClosed(false)
        }
    }, [props.isOpen])

    function resetMessages() {
        setError("")
        setSuccess("")
    }

    const base = (
        props.apiBase || "https://togari-opportunity-production.up.railway.app"
    ).replace(/\/$/, "")

    async function handleSignalSubmit(e: React.FormEvent) {
        e.preventDefault()
        resetMessages()

        if (!signalEmail.trim()) {
            setError("Email is required.")
            return
        }

        const jobTitlesArray = signalJobTitles
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)

        if (!signalQuery.trim() && jobTitlesArray.length === 0) {
            setError(
                "Please enter target job titles or describe who you're looking for."
            )
            return
        }

        const payload: { [key: string]: unknown } = {
            email: signalEmail.trim(),
            name: signalName.trim() || undefined,
            plan: selectedPlan,
            monitor_frequency: signalFrequency,
            notification_channels: [notifyMethod],
        }

        if (jobTitlesArray.length > 0) {
            payload.job_titles = jobTitlesArray
        }

        if (signalQuery.trim()) {
            payload.signal_query = signalQuery.trim()
        }

        const signalCompaniesArray = signalTargetCompanies
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
        if (signalCompaniesArray.length > 0) {
            payload.target_companies = signalCompaniesArray
        }

        if (signalIndustries.length > 0) {
            payload.industries = signalIndustries
        }
        if (signalCompanySizes.length > 0) {
            payload.company_sizes = signalCompanySizes.map(
                (label) => COMPANY_SIZE_MAP[label]
            )
        }

        if (signalNotifyEmail.trim()) {
            payload.notification_email = signalNotifyEmail.trim()
        }

        setLoading(true)

        try {
            const res = await fetch(`${base}/webhooks/framer-subscription`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-framer-secret": props.framerSecret,
                },
                body: JSON.stringify(payload),
            })

            const data = await res.json().catch(() => ({}))

            if (!res.ok) {
                setError(
                    data?.message || "Something went wrong. Please try again."
                )
                return
            }

            setSuccess("Redirecting to payment...")

            const checkoutUrl =
                data?.stripe_checkout_url ||
                data?.stripeCheckoutUrl ||
                data?.url

            if (checkoutUrl) {
                setTimeout(() => {
                    window.location.href = checkoutUrl
                }, 1000)
            }
        } catch (err) {
            setError(
                "Network error. Please check your connection and try again."
            )
        } finally {
            setLoading(false)
        }
    }

    async function handleDataSubmit(e: React.FormEvent) {
        e.preventDefault()
        resetMessages()

        if (!dataEmail.trim()) {
            setError("Email is required.")
            return
        }

        if (!dataQuery.trim()) {
            setError("Please describe the contacts you need.")
            return
        }

        const payload: { [key: string]: unknown } = {
            email: dataEmail.trim(),
            query: dataQuery.trim(),
            count: selectedCount,
        }

        const dataCompaniesArray = dataTargetCompanies
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
        if (dataCompaniesArray.length > 0) {
            payload.target_companies = dataCompaniesArray
        }

        if (dataIndustries.length > 0) {
            payload.industries = dataIndustries
        }
        if (dataCompanySizes.length > 0) {
            payload.company_sizes = dataCompanySizes.map(
                (label) => COMPANY_SIZE_MAP[label]
            )
        }

        setLoading(true)

        try {
            const res = await fetch(`${base}/webhooks/data-pull`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-framer-secret": props.framerSecret,
                },
                body: JSON.stringify(payload),
            })

            const data = await res.json().catch(() => ({}))

            if (!res.ok) {
                setError(
                    data?.message || "Something went wrong. Please try again."
                )
                return
            }

            setSuccess("Data pull created! Redirecting to payment...")

            const checkoutUrl =
                data?.stripe_checkout_url ||
                data?.stripeCheckoutUrl ||
                data?.url

            if (checkoutUrl) {
                setTimeout(() => {
                    window.open(checkoutUrl, "_blank")
                }, 1000)
            }
        } catch (err) {
            setError(
                "Network error. Please check your connection and try again."
            )
        } finally {
            setLoading(false)
        }
    }

    if (closed || !props.isOpen) return null

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                <div style={styles.header}>
                    {props.showClose && (
                        <button
                            style={styles.closeButton}
                            onClick={() => {
                                setClosed(true)
                                props.onClose?.()
                            }}
                            aria-label="Close modal"
                        >
                            ×
                        </button>
                    )}

                    <h2 style={styles.title}>{props.title}</h2>
                    <p style={styles.subtitle}>{props.subtitle}</p>

                    {props.showDataPullTab && (
                        <div style={styles.tabBar}>
                            <button
                                style={
                                    activeTab === "signal"
                                        ? styles.activeTab
                                        : styles.tabButton
                                }
                                onClick={() => {
                                    resetMessages()
                                    setActiveTab("signal")
                                }}
                            >
                                Job Posting Signals
                            </button>
                            <button
                                style={
                                    activeTab === "data"
                                        ? styles.activeTab
                                        : styles.tabButton
                                }
                                onClick={() => {
                                    resetMessages()
                                    setActiveTab("data")
                                }}
                            >
                                One-Time Data Pull
                            </button>
                        </div>
                    )}
                </div>

                <div style={styles.body}>
                    {error ? <div style={styles.errorBox}>{error}</div> : null}
                    {success ? (
                        <div style={styles.successBox}>{success}</div>
                    ) : null}

                    {activeTab === "signal" ? (
                        <form onSubmit={handleSignalSubmit} style={styles.form}>
                            <Field label="Email address" required>
                                <input
                                    style={styles.input}
                                    type="email"
                                    value={signalEmail}
                                    onChange={(e) => {
                                        setSignalEmail(e.target.value)
                                        if (error) resetMessages()
                                    }}
                                    placeholder="you@company.com"
                                />
                            </Field>

                            <Field label="Full name">
                                <input
                                    style={styles.input}
                                    type="text"
                                    value={signalName}
                                    onChange={(e) =>
                                        setSignalName(e.target.value)
                                    }
                                    placeholder="Jane Doe"
                                />
                            </Field>

                            <Field
                                label="Target job titles"
                                required
                                hint="Comma-separated. We'll monitor companies hiring for these roles and surface the recruiter or hiring manager."
                            >
                                <input
                                    style={styles.input}
                                    type="text"
                                    value={signalJobTitles}
                                    onChange={(e) =>
                                        setSignalJobTitles(e.target.value)
                                    }
                                    placeholder="e.g. VP of Sales, Head of RevOps, Director of Marketing"
                                />
                            </Field>

                            <Field
                                label="Target companies"
                                hint="Keep entries comma separated. Leave blank to monitor all companies. Max 8,192 characters."
                            >
                                <textarea
                                    style={styles.textarea}
                                    value={signalTargetCompanies}
                                    maxLength={8192}
                                    onChange={(e) =>
                                        setSignalTargetCompanies(
                                            e.target.value
                                        )
                                    }
                                    placeholder="e.g. Salesforce, HubSpot, Outreach, Gong, ZoomInfo"
                                />
                                <div style={styles.charCount}>
                                    {signalTargetCompanies.length.toLocaleString()} / 8,192 characters
                                </div>
                                {signalTargetCompanies.trim() && (
                                    <div style={styles.companyPreview}>
                                        {signalTargetCompanies
                                            .split(",")
                                            .map((c) => c.trim())
                                            .filter(Boolean)
                                            .map((c) => (
                                                <span
                                                    key={c}
                                                    style={styles.companyTag}
                                                >
                                                    {c}
                                                </span>
                                            ))}
                                    </div>
                                )}
                            </Field>

                            <Field label="Industry filter">
                                <MultiSelect
                                    options={INDUSTRIES}
                                    selected={signalIndustries}
                                    onChange={setSignalIndustries}
                                    placeholder="Select industries..."
                                />
                            </Field>

                            <Field label="Company size filter">
                                <MultiSelect
                                    options={COMPANY_SIZES}
                                    selected={signalCompanySizes}
                                    onChange={setSignalCompanySizes}
                                    placeholder="Select company sizes..."
                                />
                            </Field>

                            <Field
                                label="Additional context"
                                hint="Optional. Describe your ideal signal in natural language for more precise matching. Max 8,192 characters."
                            >
                                <textarea
                                    style={styles.textarea}
                                    value={signalQuery}
                                    maxLength={8192}
                                    onChange={(e) =>
                                        setSignalQuery(e.target.value)
                                    }
                                    placeholder="e.g. Healthcare companies in Texas hiring data engineers, 200-1000 employees, series B or later"
                                />
                                <div style={styles.charCount}>
                                    {signalQuery.length.toLocaleString()} / 8,192 characters
                                </div>
                            </Field>

                            <Field label="Monitoring frequency" required>
                                <div style={styles.radioGroup}>
                                    {(
                                        ["daily", "weekly"] as FrequencyKey[]
                                    ).filter(
                                        (value) =>
                                            !(value === "daily" && selectedPlan === "starter")
                                    ).map((value) => (
                                        <label
                                            key={value}
                                            style={styles.radioLabel}
                                        >
                                            <input
                                                type="radio"
                                                name="signalFrequency"
                                                checked={
                                                    signalFrequency === value
                                                }
                                                onChange={() =>
                                                    setSignalFrequency(value)
                                                }
                                            />
                                            <span style={styles.radioText}>
                                                {value
                                                    .charAt(0)
                                                    .toUpperCase() +
                                                    value.slice(1)}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </Field>

                            <Field label="Get notified via" required>
                                <div style={styles.radioGroup}>
                                    {(["email", "slack"] as NotifyMethod[])
                                        .filter(
                                            (v) =>
                                                v !== "email" ||
                                                props.showEmailOption
                                        )
                                        .map((value) => (
                                            <label
                                                key={value}
                                                style={styles.radioLabel}
                                            >
                                                <input
                                                    type="radio"
                                                    name="notifyMethod"
                                                    checked={
                                                        notifyMethod === value
                                                    }
                                                    onChange={() =>
                                                        setNotifyMethod(value)
                                                    }
                                                />
                                                <span style={styles.radioText}>
                                                    {value
                                                        .charAt(0)
                                                        .toUpperCase() +
                                                        value.slice(1)}
                                                </span>
                                            </label>
                                        ))}
                                </div>
                            </Field>

                            {notifyMethod === "email" && (
                                <Field
                                    label="Notification email"
                                    hint="If different from your account email."
                                >
                                    <input
                                        style={styles.input}
                                        type="email"
                                        value={signalNotifyEmail}
                                        onChange={(e) =>
                                            setSignalNotifyEmail(e.target.value)
                                        }
                                        placeholder="alerts@company.com"
                                    />
                                </Field>
                            )}

                            <div style={styles.pricingGrid}>
                                {(
                                    Object.keys(SIGNAL_PLANS) as SignalPlanKey[]
                                ).map((key) => {
                                    const plan = SIGNAL_PLANS[key]
                                    const freq: FrequencyKey =
                                        signalFrequency === "daily" && key === "starter"
                                            ? "weekly"
                                            : signalFrequency
                                    const price =
                                        FREQUENCY_PRICES[freq][key] ?? 0
                                    const selected = selectedPlan === key
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setSelectedPlan(key)}
                                            style={
                                                selected
                                                    ? styles.planCardSelected
                                                    : styles.planCard
                                            }
                                        >
                                            <div style={styles.planName}>
                                                {plan.name}
                                            </div>
                                            <div style={styles.planDetail}>
                                                {plan.maxCompanies} companies
                                            </div>
                                            <div style={styles.planPrice}>
                                                ${price}
                                                <span
                                                    style={
                                                        styles.planPriceSuffix
                                                    }
                                                >
                                                    /mo
                                                </span>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>

                            <button
                                style={styles.submitButton}
                                type="submit"
                                disabled={loading}
                            >
                                {loading
                                    ? "Creating subscription..."
                                    : `Start Monitoring — $${signalPrice}/month`}
                            </button>

                            <div style={styles.submitNote}>
                                You'll be redirected to Stripe to complete
                                payment. We'll monitor job postings at matching
                                companies and deliver recruiter contacts to your
                                chosen channel.
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleDataSubmit} style={styles.form}>
                            <Field label="Email address" required>
                                <input
                                    style={styles.input}
                                    type="email"
                                    value={dataEmail}
                                    onChange={(e) =>
                                        setDataEmail(e.target.value)
                                    }
                                    placeholder="you@company.com"
                                />
                            </Field>

                            <Field
                                label="Describe the contacts you need"
                                required
                                hint="We'll search our datalake and enrich any gaps automatically. Max 8,192 characters."
                            >
                                <textarea
                                    style={styles.textarea}
                                    value={dataQuery}
                                    maxLength={8192}
                                    onChange={(e) =>
                                        setDataQuery(e.target.value)
                                    }
                                    placeholder="e.g. VP of Sales at SaaS companies with 50-500 employees in the US"
                                />
                                <div style={styles.charCount}>
                                    {dataQuery.length.toLocaleString()} / 8,192 characters
                                </div>
                            </Field>

                            <Field
                                label="Target companies"
                                hint="Keep entries comma separated. Leave blank to search all companies. Max 8,192 characters."
                            >
                                <textarea
                                    style={styles.textarea}
                                    value={dataTargetCompanies}
                                    maxLength={8192}
                                    onChange={(e) =>
                                        setDataTargetCompanies(e.target.value)
                                    }
                                    placeholder="e.g. Salesforce, HubSpot, Outreach, Gong, ZoomInfo"
                                />
                                <div style={styles.charCount}>
                                    {dataTargetCompanies.length.toLocaleString()} / 8,192 characters
                                </div>
                                {dataTargetCompanies.trim() && (
                                    <div style={styles.companyPreview}>
                                        {dataTargetCompanies
                                            .split(",")
                                            .map((c) => c.trim())
                                            .filter(Boolean)
                                            .map((c) => (
                                                <span
                                                    key={c}
                                                    style={styles.companyTag}
                                                >
                                                    {c}
                                                </span>
                                            ))}
                                    </div>
                                )}
                            </Field>

                            <Field label="Industry filter">
                                <MultiSelect
                                    options={INDUSTRIES}
                                    selected={dataIndustries}
                                    onChange={setDataIndustries}
                                    placeholder="Select industries..."
                                />
                            </Field>

                            <Field label="Company size filter">
                                <MultiSelect
                                    options={COMPANY_SIZES}
                                    selected={dataCompanySizes}
                                    onChange={setDataCompanySizes}
                                    placeholder="Select company sizes..."
                                />
                            </Field>

                            <Field label="Number of contacts" required>
                                <div style={styles.countGrid}>
                                    {[100, 250, 500, 1000, 2500, 5000].map(
                                        (count) => {
                                            const selected =
                                                selectedCount === count
                                            return (
                                                <button
                                                    key={count}
                                                    type="button"
                                                    onClick={() =>
                                                        setSelectedCount(count)
                                                    }
                                                    style={
                                                        selected
                                                            ? styles.countCardSelected
                                                            : styles.countCard
                                                    }
                                                >
                                                    <div
                                                        style={
                                                            styles.countValue
                                                        }
                                                    >
                                                        {count.toLocaleString()}
                                                    </div>
                                                    <div
                                                        style={
                                                            styles.countLabel
                                                        }
                                                    >
                                                        contacts
                                                    </div>
                                                </button>
                                            )
                                        }
                                    )}
                                </div>
                            </Field>

                            <div style={styles.priceBox}>
                                <div>
                                    <div style={styles.priceBoxLabel}>
                                        Estimated cost
                                    </div>
                                    <div style={styles.priceBoxBreakdown}>
                                        {getBreakdown(selectedCount)}
                                    </div>
                                </div>
                                <div style={styles.priceBoxAmount}>
                                    {formatCurrency(dataPrice)}
                                </div>
                            </div>

                            <button
                                style={styles.submitButton}
                                type="submit"
                                disabled={loading}
                            >
                                {loading
                                    ? "Creating data pull..."
                                    : `Get Data — ${formatCurrency(dataPrice)}`}
                            </button>

                            <div style={styles.submitNote}>
                                You'll be redirected to Stripe. CSV delivered
                                via email when ready.
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    )
}

addPropertyControls(SubscriptionModal, {
    apiBase: {
        type: ControlType.String,
        title: "API Base",
        defaultValue: "https://togari-opportunity-production.up.railway.app",
    },
    framerSecret: {
        type: ControlType.String,
        title: "Webhook Secret",
        defaultValue: "",
        description:
            "Must match FRAMER_WEBHOOK_SECRET env var on the backend. Leave empty to skip auth (dev only).",
    },
    title: {
        type: ControlType.String,
        title: "Title",
        defaultValue: "Job Posting Signal Engine",
    },
    subtitle: {
        type: ControlType.String,
        title: "Subtitle",
        defaultValue:
            "Monitor job postings at your target companies and get recruiter contacts delivered to Slack or email.",
    },
    showClose: {
        type: ControlType.Boolean,
        title: "Close",
        defaultValue: true,
    },
    isOpen: {
        type: ControlType.Boolean,
        title: "Is Open",
        defaultValue: false,
    },
    showDataPullTab: {
        type: ControlType.Boolean,
        title: "Data Pull Tab",
        defaultValue: false,
    },
    showEmailOption: {
        type: ControlType.Boolean,
        title: "Email Notify",
        defaultValue: false,
    },
})

const styles: { [key: string]: React.CSSProperties } = {
    overlay: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "transparent",
        pointerEvents: "none",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 80,
        paddingLeft: 20,
        paddingRight: 20,
        paddingBottom: 20,
        zIndex: 1000,
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    modal: {
        width: "100%",
        maxWidth: 640,
        maxHeight: "calc(100vh - 100px)",
        overflowY: "auto",
        background: "#f8f9fc",
        borderRadius: 12,
        borderTop: "4px solid #0f3460",
        boxShadow:
            "0 8px 40px rgba(15, 52, 96, 0.18), 0 2px 8px rgba(15, 52, 96, 0.08)",
        position: "relative",
        pointerEvents: "auto",
    },
    header: {
        padding: "24px 28px 0",
        position: "sticky",
        top: 0,
        background: "#f8f9fc",
        zIndex: 2,
        borderRadius: "8px 8px 0 0",
    },
    closeButton: {
        position: "absolute",
        top: 16,
        right: 16,
        width: 32,
        height: 32,
        border: "none",
        background: "transparent",
        color: "#0f3460",
        fontSize: 24,
        cursor: "pointer",
        borderRadius: 6,
    },
    title: {
        margin: 0,
        fontSize: 24,
        fontWeight: 800,
        color: "#0f3460",
    },
    subtitle: {
        margin: "4px 0 16px",
        fontSize: 14,
        color: "#666666",
        lineHeight: 1.5,
    },
    tabBar: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        borderBottom: "2px solid #e0e0e0",
        marginBottom: 24,
    },
    tabButton: {
        padding: "12px 16px",
        border: "none",
        background: "transparent",
        fontSize: 14,
        fontWeight: 600,
        color: "#666666",
        cursor: "pointer",
        borderBottom: "2px solid transparent",
        marginBottom: -2,
        borderRadius: "6px 6px 0 0",
    },
    activeTab: {
        padding: "12px 16px",
        border: "none",
        background: "#f0f4ff",
        fontSize: 14,
        fontWeight: 600,
        color: "#0f3460",
        cursor: "pointer",
        borderBottom: "2px solid #0f3460",
        marginBottom: -2,
        borderRadius: "6px 6px 0 0",
    },
    body: {
        padding: "0 28px 28px",
    },
    form: {
        display: "flex",
        flexDirection: "column",
        gap: 0,
    },
    errorBox: {
        background: "#fff0f0",
        color: "#c0392b",
        padding: "10px 14px",
        borderRadius: 6,
        fontSize: 13,
        marginBottom: 16,
    },
    successBox: {
        background: "#f0fff4",
        color: "#2d6a4f",
        padding: 16,
        borderRadius: 6,
        fontSize: 14,
        textAlign: "center",
        marginBottom: 16,
    },
    pricingGrid: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        marginBottom: 24,
    },
    planCard: {
        border: "2px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        cursor: "pointer",
        textAlign: "center",
        background: "#ffffff",
    },
    planCardSelected: {
        border: "2px solid #0f3460",
        borderRadius: 8,
        padding: 16,
        cursor: "pointer",
        textAlign: "center",
        background: "#f0f4ff",
    },
    planName: {
        fontWeight: 600,
        fontSize: 16,
        color: "#1a1a2e",
        marginBottom: 2,
    },
    planDetail: {
        fontSize: 13,
        color: "#666666",
        marginBottom: 8,
    },
    planPrice: {
        fontSize: 24,
        fontWeight: 700,
        color: "#0f3460",
    },
    planPriceSuffix: {
        fontSize: 14,
        fontWeight: 400,
        color: "#666666",
        marginLeft: 2,
    },
    field: {
        marginBottom: 20,
    },
    label: {
        display: "block",
        fontSize: 13,
        fontWeight: 600,
        color: "#1a1a2e",
        marginBottom: 6,
    },
    required: {
        color: "#e94560",
    },
    hint: {
        fontSize: 12,
        color: "#666666",
        marginTop: 4,
        lineHeight: 1.5,
    },
    input: {
        width: "100%",
        padding: "10px 12px",
        border: "1px solid #e0e0e0",
        borderRadius: 6,
        fontSize: 14,
        color: "#1a1a2e",
        background: "#ffffff",
        outline: "none",
        boxSizing: "border-box",
    },
    textarea: {
        width: "100%",
        minHeight: 96,
        padding: "10px 12px",
        border: "1px solid #e0e0e0",
        borderRadius: 6,
        fontSize: 14,
        color: "#1a1a2e",
        background: "#ffffff",
        outline: "none",
        resize: "vertical",
        boxSizing: "border-box",
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    charCount: {
        fontSize: 11,
        color: "#999999",
        marginTop: 4,
        textAlign: "right",
    },
    companyPreview: {
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 8,
    },
    companyTag: {
        background: "#f0f4ff",
        color: "#0f3460",
        border: "1px solid #c7d4f0",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 500,
    },
    radioGroup: {
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
    },
    radioLabel: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 14,
        color: "#1a1a2e",
    },
    radioText: {
        fontSize: 14,
    },
    multiWrap: {
        position: "relative",
    },
    multiTrigger: {
        width: "100%",
        minHeight: 42,
        padding: "10px 12px",
        border: "1px solid #e0e0e0",
        borderRadius: 6,
        fontSize: 14,
        color: "#1a1a2e",
        background: "#ffffff",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        textAlign: "left",
    },
    placeholderText: {
        color: "#666666",
    },
    multiText: {
        color: "#1a1a2e",
    },
    arrow: {
        fontSize: 10,
        color: "#666666",
        marginLeft: 8,
    },
    dropdown: {
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        background: "#ffffff",
        border: "1px solid #e0e0e0",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
        maxHeight: 240,
        overflow: "hidden",
        zIndex: 10,
    },
    searchInput: {
        width: "100%",
        padding: "10px 12px",
        border: "none",
        borderBottom: "1px solid #e0e0e0",
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box",
    },
    dropdownList: {
        maxHeight: 190,
        overflowY: "auto",
    },
    dropdownItem: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        fontSize: 13,
        cursor: "pointer",
    },
    emptyDropdown: {
        padding: "10px 12px",
        fontSize: 13,
        color: "#666666",
    },
    tagsWrap: {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 6,
    },
    tag: {
        background: "#e8edf5",
        color: "#0f3460",
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 4,
        whiteSpace: "nowrap",
    },
    countGrid: {
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
    },
    countCard: {
        border: "2px solid #e0e0e0",
        borderRadius: 8,
        padding: "14px 10px",
        cursor: "pointer",
        textAlign: "center",
        background: "#ffffff",
    },
    countCardSelected: {
        border: "2px solid #0f3460",
        borderRadius: 8,
        padding: "14px 10px",
        cursor: "pointer",
        textAlign: "center",
        background: "#f0f4ff",
    },
    countValue: {
        fontSize: 18,
        fontWeight: 700,
        color: "#1a1a2e",
    },
    countLabel: {
        fontSize: 11,
        color: "#666666",
        marginTop: 2,
    },
    priceBox: {
        background: "#f8f9fa",
        borderRadius: 8,
        padding: "14px 16px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    priceBoxLabel: {
        fontSize: 14,
        color: "#666666",
        marginBottom: 2,
    },
    priceBoxBreakdown: {
        fontSize: 12,
        color: "#666666",
        lineHeight: 1.4,
    },
    priceBoxAmount: {
        fontSize: 22,
        fontWeight: 700,
        color: "#0f3460",
        whiteSpace: "nowrap",
    },
    submitButton: {
        width: "100%",
        padding: "14px 16px",
        background: "#0f3460",
        color: "#ffffff",
        border: "none",
        borderRadius: 50,
        fontSize: 16,
        fontWeight: 600,
        cursor: "pointer",
        letterSpacing: "0.3px",
    },
    submitNote: {
        textAlign: "center",
        fontSize: 12,
        color: "#666666",
        marginTop: 8,
        lineHeight: 1.5,
    },
}
