import * as React from "react"
import { addPropertyControls, ControlType } from "framer"

export default function CheckoutSuccess(props: {
    ctaLabel: string
    ctaUrl: string
}) {
    return (
        <div style={styles.page}>
            <div style={styles.card}>
                <div style={styles.eyebrow}>TOGARI SIGNAL ENGINE</div>

                <div style={styles.iconWrap}>
                    <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                        <circle cx="28" cy="28" r="28" fill="#f0f4ff" />
                        <circle
                            cx="28"
                            cy="28"
                            r="20"
                            stroke="#0f3460"
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                            opacity="0.3"
                        />
                        <path
                            d="M18 28.5l7.5 7.5 13-15"
                            stroke="#0f3460"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>

                <h1 style={styles.title}>You're all set.</h1>
                <div style={styles.divider} />
                <p style={styles.body}>
                    Your subscription is active. We're monitoring job postings
                    at your target companies and will deliver recruiter contacts
                    directly to your Slack workspace.
                </p>
                <p style={styles.note}>
                    Check your inbox for a Slack workspace invite if you haven't
                    joined yet.
                </p>

                {props.ctaUrl && (
                    <a href={props.ctaUrl} style={styles.button}>
                        {props.ctaLabel || "Back to home"}
                    </a>
                )}

                <div style={styles.footer}>
                    Powered by{" "}
                    <span style={styles.brand}>Blue Modern Advisory</span>
                </div>
            </div>
        </div>
    )
}

addPropertyControls(CheckoutSuccess, {
    ctaLabel: {
        type: ControlType.String,
        title: "Button label",
        defaultValue: "Back to home",
    },
    ctaUrl: {
        type: ControlType.String,
        title: "Button URL",
        defaultValue: "/",
    },
})

const styles: Record<string, React.CSSProperties> = {
    page: {
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "100px 24px 60px",
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: "#f8f9fc",
    },
    card: {
        width: "100%",
        maxWidth: 500,
        background: "#ffffff",
        borderRadius: 12,
        borderTop: "4px solid #0f3460",
        boxShadow:
            "0 8px 40px rgba(15, 52, 96, 0.12), 0 2px 8px rgba(15, 52, 96, 0.06)",
        padding: "52px 48px",
        textAlign: "center",
    },
    eyebrow: {
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "1.5px",
        color: "#0f3460",
        opacity: 0.5,
        textTransform: "uppercase",
        marginBottom: 28,
    },
    iconWrap: {
        marginBottom: 28,
        display: "flex",
        justifyContent: "center",
    },
    title: {
        margin: "0 0 16px",
        fontSize: 32,
        fontWeight: 800,
        color: "#0f3460",
        letterSpacing: "-0.5px",
    },
    divider: {
        width: 40,
        height: 3,
        background: "#0f3460",
        borderRadius: 2,
        margin: "0 auto 24px",
        opacity: 0.2,
    },
    body: {
        margin: "0 0 12px",
        fontSize: 15,
        lineHeight: 1.7,
        color: "#444",
    },
    note: {
        margin: "0 0 36px",
        fontSize: 13,
        lineHeight: 1.6,
        color: "#888",
    },
    button: {
        display: "inline-block",
        padding: "14px 36px",
        background: "#0f3460",
        color: "#ffffff",
        borderRadius: 50,
        fontSize: 15,
        fontWeight: 600,
        textDecoration: "none",
        letterSpacing: "0.3px",
    },
    footer: {
        marginTop: 36,
        fontSize: 12,
        color: "#aaa",
    },
    brand: {
        color: "#0f3460",
        fontWeight: 600,
    },
}
