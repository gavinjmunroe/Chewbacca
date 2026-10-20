"""Pydantic schemas for UC1 community-event matching."""
from __future__ import annotations
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


# ---------- Request ----------
class EventInfo(BaseModel):
    id: str
    type: Literal["community_event"] = "community_event"
    name: str
    city: str
    venue: str
    startsAt: str
    attendeeCount: int


class HostNote(BaseModel):
    eventId: str
    notes: str


class FeedbackEntry(BaseModel):
    eventId: str
    oneWord: Optional[str] = None
    myDinner: Optional[str] = None
    highlight: Optional[str] = None
    improvement: Optional[str] = None
    nextBigEvent: Optional[str] = None
    anythingElse: Optional[str] = None


class Attendee(BaseModel):
    id: str
    age: Optional[int] = None
    ageGroupPreference: Optional[
        Literal["22-25", "26-30", "31-35", "no_preference"]
    ] = None
    gender: Optional[Literal["man", "woman", "non_binary"]] = None
    city: Optional[str] = None
    occupation: Optional[str] = None
    guestType: Optional[Literal["storyteller", "investigator", "listener"]] = None
    guestArchetype: List[str] = Field(default_factory=list)
    whyJoin: Optional[str] = None
    socialBravery: Optional[str] = None
    passion: Optional[str] = None
    screeningNotes: Optional[str] = None
    hostNotes: List[HostNote] = Field(default_factory=list)
    feedback: List[FeedbackEntry] = Field(default_factory=list)
    welcomeDinnerEventId: Optional[str] = None
    eventsAttended: List[str] = Field(default_factory=list)
    excludedPartnerIds: List[str] = Field(default_factory=list)


class Grouping(BaseModel):
    mode: Literal["groups_with_leader"]
    groupSize: int
    groupCount: int
    leaderIds: List[str]


class MatchRequest(BaseModel):
    runId: str
    event: EventInfo
    attendees: List[Attendee]
    grouping: Optional[Grouping] = None


# ---------- PeopleRank (Amber middle-tab: rank the caller's own contacts) ----------
class FactIn(BaseModel):
    text: str
    category: Optional[str] = None
    sentiment: Optional[str] = None
    sentiment_strength: Optional[float] = None
    certainty: Optional[float] = None
    is_conditional: Optional[bool] = False
    condition_text: Optional[str] = None
    is_past: Optional[bool] = False
    weight: Optional[float] = None
    # ISO8601 of when this fact was LEARNED -- not when the thing it describes
    # happens. Without it a visit said last week and the same visit said last
    # year are the same sentence, which is why a trip kept ranking months after
    # it ended. Optional: a sender that predates this field simply omits it and
    # every consumer treats None as "undated", i.e. the previous behaviour.
    observed_at: Optional[str] = None


class MeProfile(BaseModel):
    """The signed-in user, used for the structured proximity signal. All optional."""
    id: str = "me"
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    city: Optional[str] = None
    occupation: Optional[str] = None
    bio: Optional[str] = None
    timezone: Optional[str] = None
    facts: List[FactIn] = Field(default_factory=list)
    # Extended structured prior (all optional, additive). Empty => identical
    # proximity to the legacy city/occupation-only signal.
    schools: List[str] = Field(default_factory=list)
    cities: List[str] = Field(default_factory=list)      # places the user has lived
    employers: List[str] = Field(default_factory=list)
    hometown: Optional[str] = None


class ContactIn(BaseModel):
    contactId: str
    name: str
    company: Optional[str] = None
    title: Optional[str] = None
    city: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    facts: List[FactIn] = Field(default_factory=list)
    # Additive relevance context (all optional). Empty => identical scoring.
    linkedin_url: Optional[str] = None
    industry: Optional[str] = None
    tags: List[str] = Field(default_factory=list)


class PeopleRankRequest(BaseModel):
    query: Optional[str] = None
    limit: int = 15
    me: Optional[MeProfile] = None
    contacts: List[ContactIn] = Field(default_factory=list)
    now: Optional[str] = None
    now_local: Optional[str] = None
    # Whether to run Stage 3 (the ~5s grounded-answer Claude call). Default True
    # keeps the existing behavior byte-identical for every current caller. The
    # realtime voice tool sets it False: it speaks the reply itself, so it only
    # needs the ranked people and must not pay the Stage-3 cost.
    answer: bool = True


# ---------- Response ----------
class ScoreBreakdown(BaseModel):
    textSimilarity: float
    structuredSimilarity: float
    trust: float
    readinessHarmony: float
    explanation: str


class PairOut(BaseModel):
    memberId: str
    partnerId: str
    rank: Literal[1, 2]
    rationale: str
    compatibilityScore: float
    confidence: Literal["high", "medium", "low"] = "medium"
    scoreBreakdown: Optional[ScoreBreakdown] = None
    signals: List[str] = Field(default_factory=list)


class SkippedOut(BaseModel):
    memberId: str
    reason: Literal["no_viable_partners", "insufficient_screening", "low_confidence"]
    note: Optional[str] = None


class GroupMemberOut(BaseModel):
    guestId: str
    rationale: str


class GroupOut(BaseModel):
    groupId: str
    leaderId: str
    members: List[GroupMemberOut]
    groupRationale: str
    scoreBreakdown: Optional[ScoreBreakdown] = None


class MatchResponse(BaseModel):
    runId: str
    model: str = "peoplerank-uc1-v1"
    generatedAt: str
    pairs: List[PairOut]
    skipped: List[SkippedOut]


class GroupMatchResponse(BaseModel):
    runId: str
    model: str = "peoplerank-uc3-v1"
    generatedAt: str
    groups: List[GroupOut]
    skipped: List[SkippedOut]
