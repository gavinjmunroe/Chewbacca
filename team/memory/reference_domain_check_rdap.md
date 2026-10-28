---
name: reference_domain_check_rdap
description: Check if a .com name is taken with Verisign RDAP (200 = registered, 404 = free) in about a second, no whois; other registries' RDAP can answer 200 for everything
metadata:
  type: reference
---

For a fast name check, `curl -s -o /dev/null -w '%{http_code}' https://rdap.verisign.com/com/v1/domain/<name>.com` returns 200 when the domain is registered and 404 when it's free. On 2026-10-28 it checked 14 USC OS name candidates in seconds.

Other TLDs are unreliable this way: rdap.nic.so and rdap.org answered 200 for every .so and .in name tried that day, including invented ones, so a 200 there proves nothing. .app goes through pubapi.registry.google/rdap/domain/<name>.app. Confirm any "free" result at a registrar before telling Caleb a domain is available, and run a control (a made-up name that has to be free) first.
