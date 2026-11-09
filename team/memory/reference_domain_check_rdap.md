---
name: reference_domain_check_rdap
description: Check if a domain is taken through the registry's RDAP (200 = registered, 404 = free) in about a second, no whois; run a made-up control name first
metadata:
  type: reference
---

For a fast name check, curl the registry's RDAP and read the status code: 200 means registered, 404 means free.

- .com: `https://rdap.verisign.com/com/v1/domain/<name>.com`
- .app: `https://pubapi.registry.google/rdap/domain/<name>.app`
- .so: `https://rdap.nic.so/domain/<name>.so`
- anything else: `https://rdap.org/domain/<name>.<tld>` with `-L`

On 2026-10-28 every USC OS name candidate came back 200 on .com, .app and .so. The tab first doubted the .so and .in answers as "200 for everything", then a made-up control (zqxv7kq2plm) answered 404 on all four endpoints, so the 200s were real. Run that control before calling any endpoint unreliable, and confirm a "free" result at a registrar before telling Caleb a domain is available.
