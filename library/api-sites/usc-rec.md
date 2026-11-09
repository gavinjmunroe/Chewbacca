# usc-rec

usc-rec answers "how packed is the gym right now" for USC Recreational Sports without opening recsports.usc.edu. facilityTraffic returns every counted area at the Lyon Center, the USC Village Fitness Center, the HSC Fitness Center and Aquatics.

- facilityTraffic() -> facility, area, count, capacity, closed, updated

Caveats observed on 2026-10-13:

- The Current Facility Traffic page (recsports.usc.edu/rec-facilities/current-facility-traffic/) embeds a Connect2 widget from connect2mycloud.com. Its numbers come from one public GET on goboardapi.azurewebsites.net keyed by USC's widget key, which the page serves to every visitor. That host is in hosts.allow and receives no cookie. recsports.usc.edu itself answers curl with a 403 (Cloudflare), so the page is never fetched.
- count is the widget's "Last Count" and updated is its "Updated" time, in Pacific time with no zone suffix. At 9:03 am the widget showed LRC Weight Room "Last Count: 40, Updated: 10/13/2026 09:03 AM" and the op returned count 40, updated 2026-10-13T09:03:34.
- The widget's percent ring isn't count over capacity (56% for 40 of 150), so it isn't returned. Compute your own from count and capacity.
- An area whose updated time is days old isn't being counted (the dive pools in the off season). closed is the site's own flag.
- The op has no inputs. Filter by facility or area on your side.
