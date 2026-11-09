# usc-maps

usc-maps finds a USC building or place on the official campus map (maps.usc.edu) by name or building code, so "where is THH 101" is one call.

- searchPlaces(q) -> name, category, id, lat, lng

Caveats observed on 2026-10-13:

- maps.usc.edu is a Concept3D map (map id 1928). Its search box calls api.concept3d.com/search with the public map key the page serves to every visitor. That host is in hosts.allow and receives no cookie.
- Building codes work when the map's name carries them: SGM returned "Seeley G. Mudd Building (SGM)", DML is in "Doheny Memorial Library (DML)". VKC returned nothing on this date, so fall back to the full name ("Von KleinSmid").
- A building can come back under a feature category instead of Buildings (SGM came back as "Auditory Assistance"). The name and coordinates are the same.
- Results are the map's first 10, ranked by the map. Nothing found is `[]`.
- Checked against the page: typing SGM into the map's search box listed "Seeley G. Mudd Building (SGM)", the same as the op.
