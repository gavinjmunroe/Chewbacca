import LandingClient from "./LandingClient";

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "EGATS",
            "url": process.env.NEXT_PUBLIC_APP_URL ?? "https://egats.com",
            "description": "Professional platform connecting verified dance talent with recruiters",
            "potentialAction": {
              "@type": "SearchAction",
              "target": `${process.env.NEXT_PUBLIC_APP_URL ?? "https://egats.com"}/dashboard/dancers?q={search_term_string}`,
              "query-input": "required name=search_term_string"
            }
          })
        }}
      />
      <LandingClient />
    </>
  );
}
