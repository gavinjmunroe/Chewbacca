"""Seed pass 01 — root entities, places, eras, edges, and first episode."""
import json
import amber_kg as k

SAGAR = "person:sagar-tiwari"
DAD = "person:umesh-kumar-tiwari"

def ent(eid, name, node_type, text, dim="intellectual", extra=None, trust=0.95):
    return {"kind": "entity", "text": text, "source": "knowledge-graph",
            "healthDimension": dim, "trust": trust,
            "extra": {"graph_layer": "entity", "entity_id": eid,
                      "node_type": node_type, "canonical_name": name,
                      **(extra or {})}}

def edge(s, p, o, text, conf=0.95, dim="social"):
    return {"kind": "edge", "text": text, "source": "knowledge-graph",
            "healthDimension": dim, "trust": conf,
            "extra": {"graph_layer": "edge", "subject": s, "predicate": p,
                      "object": o, "confidence": conf}}

def episode(text, theme, place=None, era=None, people=None, dim="emotional",
            created=None, conf=0.9):
    return {"kind": "episode", "text": text, "source": "knowledge-graph",
            "healthDimension": dim, "trust": conf, "createdAt": created,
            "extra": {"graph_layer": "episode", "theme": theme,
                      "place": place, "era": era,
                      "people": people or [], "confidence": conf}}

items = []

# ---- people ----
items += [
    ent(SAGAR, "Sagar Tiwari", "person",
        "Sagar Tiwari is the subject of this knowledge graph. Founder of Amber, "
        "building agentic memory systems. Son of Umesh Kumar Tiwari.",
        extra={"role": "self", "is_root": True}),
    ent(DAD, "Umesh Kumar Tiwari", "person",
        "Umesh Kumar Tiwari, called 'dad' by Sagar. Born in Shahpura, Madhya "
        "Pradesh, India. Left home at 13 for high school in Mandla, attended "
        "college in Raipur, then lived across India before emigrating to the "
        "United States in 1993 — the first person from his village to do so. "
        "Career in IT, moving into cybersecurity in 2009. Spoke in deep, "
        "philosophical terms.",
        dim="spiritual", extra={"role": "father", "aliases": ["dad", "Umesh"]}),
    ent("person:sindhu", "Sindhu", "person",
        "Sindhu, whose graduation Sagar and his dad attended together. "
        "Relationship to Sagar not yet confirmed — needs follow-up.",
        dim="social", extra={"needs_followup": True}, trust=0.5),
]

# ---- places ----
items += [
    ent("place:shahpura-mp", "Shahpura, Madhya Pradesh", "place",
        "Shahpura, Madhya Pradesh, India — the village where Umesh Kumar "
        "Tiwari was born. He was the first person from this village to go to "
        "the United States.", dim="environmental",
        extra={"country": "India", "region": "Madhya Pradesh"}),
    ent("place:mandla", "Mandla", "place",
        "Mandla, Madhya Pradesh, India — where Umesh moved at age 13, living "
        "away from his family in order to attend high school.",
        dim="environmental", extra={"country": "India"}),
    ent("place:raipur", "Raipur", "place",
        "Raipur, India — where Umesh went to college.",
        dim="environmental", extra={"country": "India"}),
    ent("place:united-states", "United States", "place",
        "The United States — where Umesh emigrated in 1993, the first from "
        "his village.", dim="environmental"),
]

# ---- eras ----
items += [
    ent("era:umesh-mandla-1970s", "Mandla years (from age 13)", "era",
        "The era beginning when Umesh left Shahpura at 13 to attend high "
        "school in Mandla — leaving home as a child for education.",
        dim="occupational", extra={"person": DAD, "start_age": 13}),
    ent("era:umesh-emigration-1993", "Emigration to the US, 1993", "era",
        "1993: Umesh Kumar Tiwari emigrated to the United States, the first "
        "person from his village of Shahpura to do so.",
        dim="occupational", extra={"person": DAD, "year": 1993}),
    ent("era:umesh-cyber-2009", "Shift to cybersecurity, 2009", "era",
        "2009: after a career in IT, Umesh moved into cybersecurity.",
        dim="occupational", extra={"person": DAD, "year": 2009}),
]

# ---- traits / values ----
items += [
    ent("trait:umesh-philosophical-speech", "Speaks philosophically", "value",
        "Umesh always spoke in very deep, very philosophical terms — his "
        "characteristic register, even about ordinary things like work.",
        dim="spiritual", extra={"person": DAD}),
]

# ---- occupations ----
items += [
    ent("work:umesh-it", "IT career", "work",
        "Umesh's career in information technology, preceding his 2009 move "
        "into cybersecurity.", dim="occupational", extra={"person": DAD}),
    ent("work:umesh-cybersecurity", "Cybersecurity career", "work",
        "Umesh's cybersecurity career, begun in 2009.",
        dim="occupational", extra={"person": DAD}),
]

# ---- edges ----
items += [
    edge(SAGAR, "child_of", DAD, "Sagar Tiwari is the son of Umesh Kumar Tiwari."),
    edge(DAD, "parent_of", SAGAR, "Umesh Kumar Tiwari is the father of Sagar Tiwari."),
    edge(SAGAR, "calls", DAD, "Sagar calls Umesh Kumar Tiwari 'dad'."),
    edge(DAD, "born_in", "place:shahpura-mp",
         "Umesh Kumar Tiwari was born in Shahpura, Madhya Pradesh."),
    edge(DAD, "moved_to", "place:mandla",
         "At 13, Umesh moved to Mandla to attend high school, living away from home."),
    edge(DAD, "studied_in", "place:raipur", "Umesh attended college in Raipur."),
    edge(DAD, "emigrated_to", "place:united-states",
         "In 1993 Umesh emigrated to the United States, the first person from "
         "his village to do so.", dim="occupational"),
    edge(DAD, "worked_as", "work:umesh-it", "Umesh worked in IT.", dim="occupational"),
    edge(DAD, "worked_as", "work:umesh-cybersecurity",
         "Umesh moved into cybersecurity in 2009.", dim="occupational"),
    edge(DAD, "has_trait", "trait:umesh-philosophical-speech",
         "Umesh speaks in deep, philosophical terms.", dim="spiritual"),
    edge(SAGAR, "attended_with", DAD,
         "Sagar and his dad attended Sindhu's graduation together.", dim="emotional"),
]

# ---- episodes ----
items += [
    episode(
        "Leaving home at thirteen: Umesh moved from Shahpura to Mandla at age "
        "13 so he could go to high school. A child living apart from his "
        "family for the sake of school — the first of the departures that "
        "defined his life.",
        theme="departure", place="place:mandla",
        era="era:umesh-mandla-1970s", people=[DAD], dim="occupational"),
    episode(
        "First from the village: in 1993, after college in Raipur and years "
        "living all around India, Umesh Kumar Tiwari left for the United "
        "States — the first person from Shahpura ever to do it.",
        theme="departure", place="place:united-states",
        era="era:umesh-emigration-1993", people=[DAD], dim="occupational"),
    episode(
        "Sindhu's graduation: Sagar and his dad got to hang out together at "
        "Sindhu's graduation. Sagar names this as a memory he never wants to "
        "lose — not for the ceremony, but for the time the two of them got "
        "with each other.",
        theme="time_together", people=[DAD, SAGAR, "person:sindhu"],
        dim="emotional", conf=1.0),
]

if __name__ == "__main__":
    res = k.upsert(items)
    print(json.dumps({"upserted": res["upserted"], "namespace": res["namespace"],
                      "counts": {kd: sum(1 for i in items if i["kind"] == kd)
                                 for kd in ("entity", "edge", "episode")}}, indent=2))
